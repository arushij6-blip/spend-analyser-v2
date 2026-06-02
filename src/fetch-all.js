/**
 * Fetch and categorize all Axis Bank transaction alerts from a given start date.
 *
 * Pipeline:
 *   1. List all matching Gmail message IDs (after:YYYY/MM/DD)
 *   2. Fetch each in parallel (concurrency-limited) with format=full
 *   3. Parse → structured transaction record
 *   4. Dedupe (same date+time+amount+type)
 *   5. Categorize (Daily Commute rule + merchant keyword mapping)
 *   6. Write data/transactions.json and data/transactions.csv
 *   7. Print summary + list of uncategorized merchants for user review
 *
 * Usage: `node src/fetch-all.js [YYYY-MM-DD]`
 *   Defaults to 2025-05-01.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuthClient, getAllAuthClients, getAuthenticatedAccounts } from './auth.js';
import {
  listMessageIds,
  getMessage,
  getHeader,
  getBodyByMimeType,
} from './gmail-client.js';
import { parseAxisTransactionEmail } from './transaction-parser.js';
import { categorize } from './categorizer.js';
import { EMAIL_SOURCE_MAP, DEFAULT_SOURCE } from '../config.local.js';

const DEFAULT_START_DATE = '2025-05-01';
const CONCURRENCY = 8; // gmail API quota is generous; 8 is safe
const FETCH_HARD_CAP = 2000; // sanity cap on number of messages

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');

function buildQuery(startDate /* YYYY-MM-DD */) {
  // Gmail's `after:` operator uses YYYY/MM/DD.
  // Axis Bank uses two alert sender addresses:
  //   - alerts@axisbank.com   (legacy, used through Dec 2025)
  //   - alerts@axis.bank.in   (new domain, Jan 2026 onwards)
  // We include both so the cutover doesn't drop any transactions.
  const gmailDate = startDate.replace(/-/g, '/');
  return `(from:alerts@axisbank.com OR from:alerts@axis.bank.in) after:${gmailDate} (debited OR credited)`;
}

/**
 * Get source name based on email account. Configured in config.local.js.
 */
function getSourceForEmail(email) {
  return EMAIL_SOURCE_MAP[email] ?? DEFAULT_SOURCE;
}

/**
 * Run an async mapper over `items` with a fixed worker concurrency.
 * Preserves input order in the output array.
 */
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  let completed = 0;
  const total = items.length;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { __error: err.message, __index: i };
      }
      completed++;
      if (completed % 25 === 0 || completed === total) {
        process.stdout.write(`\r  fetched ${completed}/${total} messages…   `);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, total) }, worker);
  await Promise.all(workers);
  process.stdout.write('\n');
  return results;
}

/** Stable dedupe key: same transaction can appear in multiple alert mails. */
function dedupeKey(txn) {
  return [
    txn.type,
    txn.amount,
    txn.date,
    txn.time,
    txn.account ?? '',
    txn.transactionId ?? '',
  ].join('|');
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const cols = [
    'date',
    'time',
    'type',
    'amount',
    'currency',
    'category',
    'subCategory',
    'merchant',
    'transactionInfoCategory',
    'account',
    'transactionId',
    'bankHandle',
    'rawTransactionInfo',
    'emailSubject',
    'emailReceivedAt',
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = cols.join(',');
  const lines = rows.map((r) =>
    cols
      .map((c) => {
        if (c === 'transactionInfoCategory') return escape(r._origCategory);
        return escape(r[c]);
      })
      .join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}

function summarize(rows) {
  const byCategory = new Map();
  for (const r of rows) {
    if (!byCategory.has(r.category)) {
      byCategory.set(r.category, { count: 0, debit: 0, credit: 0 });
    }
    const bucket = byCategory.get(r.category);
    bucket.count++;
    if (r.type === 'DEBIT') bucket.debit += r.amount;
    else bucket.credit += r.amount;
  }
  return Array.from(byCategory.entries())
    .map(([category, agg]) => ({ category, ...agg, net: agg.debit - agg.credit }))
    .sort((a, b) => b.debit - a.debit);
}

function pad(s, w) {
  const str = String(s);
  return str.length >= w ? str : str + ' '.repeat(w - str.length);
}

function fmtAmount(n) {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Scan transactions from a specific email account.
 *
 * @param {string} startDate - YYYY-MM-DD format
 * @param {string} [email] - specific account to scan, or undefined for all accounts
 * @returns {Promise<{inserted, updated, total, email}>} results for each account
 */
export async function scanTransactions(startDate, email) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error(`Invalid start date: ${startDate}. Use YYYY-MM-DD.`);
  }

  let authClients = [];
  if (email) {
    // Single account
    const auth = await getAuthClient(email);
    authClients = [{ email, auth }];
  } else {
    // All accounts
    authClients = await getAllAuthClients();
  }

  if (authClients.length === 0) {
    throw new Error('No authenticated accounts found. Run: node src/auth.js <email>');
  }

  const results = [];

  for (const { email: acctEmail, auth } of authClients) {
    console.log(`\n▶ Scanning ${acctEmail}…`);
    try {
      const result = await scanSingleAccount(acctEmail, auth, startDate);
      results.push(result);
    } catch (err) {
      console.error(`✗ ${acctEmail}: ${err.message}`);
      results.push({ email: acctEmail, error: err.message, categorized: [] });
    }
  }

  return results;
}

async function scanSingleAccount(email, auth, startDate) {
  const query = buildQuery(startDate);
  console.log(`  Query: ${query}`);
  const ids = await listMessageIds(auth, query, FETCH_HARD_CAP);
  console.log(`  found ${ids.length} message(s).`);

  if (ids.length === 0) {
    console.log('  No messages found.');
    return { email, inserted: 0, updated: 0, total: 0 };
  }

  console.log(`  Fetching full bodies (concurrency=${CONCURRENCY})…`);
  const messages = await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
    const m = await getMessage(auth, id);
    return { id, message: m };
  });

  console.log(`→ Parsing…`);
  const parsed = [];
  let skipped = 0;
  for (const item of messages) {
    if (item.__error) {
      skipped++;
      continue;
    }
    const m = item.message;
    const subject = getHeader(m, 'Subject');
    const from = getHeader(m, 'From');
    const date = getHeader(m, 'Date');
    const html = getBodyByMimeType(m, 'text/html');
    const plaintext = getBodyByMimeType(m, 'text/plain');
    const txn = parseAxisTransactionEmail({ html, plaintext, subject, date });
    if (txn) {
      txn.messageId = item.id;
      txn.from = from;
      parsed.push(txn);
    } else {
      skipped++;
    }
  }
  console.log(`  parsed ${parsed.length} txn(s); skipped ${skipped} non-txn email(s).`);

  console.log(`  Deduping…`);
  const seen = new Set();
  const unique = [];
  for (const t of parsed) {
    const k = dedupeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(t);
  }
  console.log(`  ${unique.length} unique txn(s) (removed ${parsed.length - unique.length} duplicate(s)).`);

  console.log(`  Categorizing…`);
  const source = getSourceForEmail(email);
  const categorized = unique
    .map((t) => {
      const out = categorize(t);
      out._origCategory = t.category;
      out.source = source;  // Set source based on email account
      return out;
    })
    .filter((t) => t.category !== 'Self Transfer' && t.category !== 'Investments');
  console.log(`  ${categorized.length} txn(s) after excluding Self Transfer & Investments.`);

  return { email, categorized };
}

async function main() {
  const startDate = process.argv[2] ?? DEFAULT_START_DATE;
  const allResults = await scanTransactions(startDate);

  // Aggregate all transactions from all accounts
  const allCategorized = [];
  for (const result of allResults) {
    if (result.categorized) {
      allCategorized.push(...result.categorized);
    }
  }

  if (allCategorized.length === 0) {
    console.log('\nNo transactions found.');
    return;
  }

  // Sort newest → oldest
  allCategorized.sort((a, b) => {
    const ka = (a.date ?? '') + (a.time ?? '');
    const kb = (b.date ?? '') + (b.time ?? '');
    return kb.localeCompare(ka);
  });

  await fs.mkdir(DATA_DIR, { recursive: true });
  const jsonPath = path.join(DATA_DIR, 'transactions.json');
  const csvPath = path.join(DATA_DIR, 'transactions.csv');
  await fs.writeFile(jsonPath, JSON.stringify(allCategorized, null, 2));
  await fs.writeFile(csvPath, toCsv(allCategorized));
  console.log(`\n→ Wrote ${allCategorized.length} rows to:`);
  console.log(`    ${jsonPath}`);
  console.log(`    ${csvPath}`);

  // ----- Summary -----
  console.log('\n═══ Category summary ═══');
  const summary = summarize(allCategorized);
  console.log(
    pad('Category', 22) +
      pad('Count', 8) +
      pad('Debit', 16) +
      pad('Credit', 16) +
      'Net Spend'
  );
  console.log('─'.repeat(78));
  for (const row of summary) {
    console.log(
      pad(row.category, 22) +
        pad(row.count, 8) +
        pad(fmtAmount(row.debit), 16) +
        pad(fmtAmount(row.credit), 16) +
        fmtAmount(row.net)
    );
  }

  // Misc categories check
  const miscMerchants = new Map();
  for (const r of allCategorized) {
    if (r.category === 'Misc') {
      const key = r.merchant ?? '(no merchant)';
      const bucket = miscMerchants.get(key) ?? { count: 0, total: 0 };
      bucket.count++;
      if (r.type === 'DEBIT') bucket.total += r.amount;
      miscMerchants.set(key, bucket);
    }
  }

  if (miscMerchants.size > 0) {
    console.log('\n═══ Misc category merchants (review & rule them) ═══');
    const sorted = Array.from(miscMerchants.entries()).sort(
      (a, b) => b[1].total - a[1].total
    );
    console.log(pad('Merchant', 40) + pad('Count', 8) + 'Total Debit');
    console.log('─'.repeat(70));
    for (const [merchant, agg] of sorted) {
      console.log(
        pad(merchant.slice(0, 38), 40) +
          pad(agg.count, 8) +
          fmtAmount(agg.total)
      );
    }
  }
}

main().catch((err) => {
  console.error('\n✗ Failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
