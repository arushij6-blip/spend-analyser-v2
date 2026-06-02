/**
 * Library function that runs a full Gmail scan and writes results to SQLite.
 *
 * Supports multi-account scanning:
 *   - Scans all authenticated Gmail accounts
 *   - Aggregates results across accounts
 *   - Dedupes and writes to single SQLite database
 *
 * Used by:
 *   - the web API route (`POST /api/scan`)
 *   - (optionally) a future CLI wrapper
 */

import { scanTransactions } from '../src/fetch-all.js';
import { categorize } from '../src/categorizer.js';
import { getLearnedRules, upsertTransactions } from './db.js';
import { checkAndSendBudgetAlertsAsync } from './budget-alerts.js';
import { EMAIL_SOURCE_MAP, DEFAULT_SOURCE } from '../config.local.js';

/**
 * Get source name based on email account. Configured in config.local.js.
 */
function getSourceForEmail(email) {
  return EMAIL_SOURCE_MAP[email] ?? DEFAULT_SOURCE;
}

function dedupeKey(t) {
  return [
    t.type,
    t.amount,
    t.date,
    t.time,
    t.account ?? '',
    t.transaction_id ?? '',
  ].join('|');
}

/**
 * Run a scan from all authenticated accounts and write results into the database.
 *
 * @param {string} startDate - YYYY-MM-DD, inclusive lower bound
 * @returns {Promise<{ accounts: string[], found: number, written: number, inserted: number, updated: number }>}
 */
export async function runScan(startDate = '2026-04-01') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid start date: ${startDate}. Use YYYY-MM-DD.`);
  }

  // Scan all authenticated accounts
  let allResults;
  try {
    allResults = await scanTransactions(startDate);
  } catch (err) {
    if (err.message.includes('No authenticated accounts')) {
      return {
        accounts: [],
        found: 0,
        written: 0,
        inserted: 0,
        updated: 0,
      };
    }
    throw err;
  }

  if (!allResults || allResults.length === 0) {
    return {
      accounts: [],
      found: 0,
      written: 0,
      inserted: 0,
      updated: 0,
    };
  }

  // Load learned rules once (applies to all accounts)
  const learnedRules = getLearnedRules();

  // Aggregate transactions from all accounts
  const allCategorized = [];
  const scannedAccounts = [];
  const failedAccounts = [];
  let totalFound = 0;

  for (const result of allResults) {
    if (result.error) {
      failedAccounts.push({ email: result.email, error: result.error });
      continue;
    }
    if (!result.categorized) continue;
    scannedAccounts.push(result.email);
    totalFound += result.categorized.length;

    // Re-categorize with learned rules (in case rules changed since scan)
    const source = getSourceForEmail(result.email);
    for (const txn of result.categorized) {
      const recat = categorize(txn, learnedRules);
      // Exclude Self Transfer, Investments, and Credit Card Bill payments —
      // none of these are expenses (CC bill payments would double-count the
      // underlying purchases already captured on the card statement).
      if (
        recat.category === 'Self Transfer' ||
        recat.category === 'Investments' ||
        recat.category === 'Credit Card Bill'
      ) continue;
      allCategorized.push({
        message_id: txn.messageId,
        date: recat.date,
        time: recat.time,
        type: recat.type,
        amount: recat.amount,
        currency: recat.currency ?? 'INR',
        account: recat.account,
        merchant: recat.merchant,
        category: recat.category,
        auto_category: recat.category,
        sub_category: recat.subCategory,
        transaction_id: recat.transactionId,
        bank_handle: recat.bankHandle,
        raw_transaction_info: recat.rawTransactionInfo,
        email_subject: txn.emailSubject,
        email_received_at: txn.emailReceivedAt,
        source: source,
        is_refund: recat.isRefund ? 1 : 0,
      });
    }
  }

  if (allCategorized.length === 0) {
    return {
      accounts: scannedAccounts,
      failedAccounts,
      found: totalFound,
      written: 0,
      inserted: 0,
      updated: 0,
    };
  }

  // Dedupe across all accounts (by date+time+amount+type+account+txnId)
  const seen = new Set();
  const unique = [];
  for (const r of allCategorized) {
    const k = dedupeKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }

  // Write to database
  const { inserted, updated } = upsertTransactions(unique);

  // Best-effort: evaluate budget thresholds against the freshly-written totals
  // and fire any 80% / 100% Telegram alerts that haven't yet been sent for
  // the current month. Failures here must never block the scan response.
  checkAndSendBudgetAlertsAsync();

  return {
    accounts: scannedAccounts,
    failedAccounts,
    found: totalFound,
    written: unique.length,
    inserted,
    updated,
  };
}
