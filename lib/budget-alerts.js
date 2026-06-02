/**
 * Budget alert orchestrator.
 *
 * Pure logic: walk this month's budgets, compare to net spend, and dispatch
 * a Telegram alert when a (category, threshold) crosses 80% or 100% for the
 * first time this month.
 *
 * Dedup contract:
 *   - `budget_alerts(category, month, threshold)` is the canonical record of
 *     "already sent". We check before send and write after a successful send.
 *   - 80% and 100% are independent rows. Jumping past 80% straight to 105%
 *     in one scan still fires BOTH alerts (in order).
 *
 * Best-effort: this function is called from write paths (scan, upload) and
 * must never block them. All failures are swallowed and logged.
 */

import {
  getBudgetsForMonth,
  getCategorySpendForMonth,
  wasAlertSent,
  markAlertSent,
} from './db.js';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';
import { formatAlertMessage } from './alert-tones.js';

const THRESHOLDS = [80, 100];

function currentMonth(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Check budgets for the given month and send any alerts that are due.
 * @param {object} opts
 * @param {string} [opts.month]  'YYYY-MM' — defaults to current month
 * @returns {Promise<{sent: Array<{category, threshold}>, skipped: number, configured: boolean}>}
 */
export async function checkAndSendBudgetAlerts({ month } = {}) {
  const configured = isTelegramConfigured();
  const mo = month ?? currentMonth();

  const budgets = await getBudgetsForMonth(mo);
  if (budgets.length === 0) {
    return { sent: [], skipped: 0, configured };
  }

  const spendByCat = await getCategorySpendForMonth(mo);
  const sent = [];
  let skipped = 0;

  for (const { category, amount } of budgets) {
    if (!amount || amount <= 0) continue;
    const spent = spendByCat.get(category) ?? 0;
    const pct = (spent / amount) * 100;

    for (const threshold of THRESHOLDS) {
      if (pct < threshold) continue;
      if (await wasAlertSent(category, mo, threshold)) {
        skipped++;
        continue;
      }
      if (!configured) {
        // Not configured — don't mark sent; user may wire credentials later
        // and want the alert to fire then.
        skipped++;
        continue;
      }
      const text = formatAlertMessage({
        threshold,
        category,
        month: mo,
        spent,
        budget: amount,
      });
      const { ok } = await sendTelegramMessage(text);
      if (ok) {
        await markAlertSent(category, mo, threshold);
        sent.push({ category, threshold });
      } else {
        skipped++;
      }
    }
  }

  return { sent, skipped, configured };
}

/**
 * Fire-and-forget wrapper for write paths. Never throws.
 */
export function checkAndSendBudgetAlertsAsync(opts) {
  checkAndSendBudgetAlerts(opts).catch((err) => {
    console.error('[budget-alerts] check failed:', err?.message ?? err);
  });
}
