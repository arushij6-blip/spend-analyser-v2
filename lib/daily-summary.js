/**
 * Daily expense summary for Telegram.
 *
 * Called from the cron scan after fresh rows land. Reads today's transactions
 * (00:00 → now, IST-aware) and posts a tight summary: net total + top 2
 * debits.
 *
 * Best-effort: any failure is logged and swallowed so the cron route can
 * still report scan success.
 */

import { getPool } from './db.js';
import { sendTelegramMessage, isTelegramConfigured } from './telegram.js';

/**
 * YYYY-MM-DD in IST regardless of where the function runs (Vercel = UTC).
 * Cron fires at 13:30 UTC = 19:00 IST so this naturally returns today's
 * IST date.
 */
function todayInIST() {
  // toLocaleDateString with 'en-CA' yields YYYY-MM-DD exactly.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function fmtINR(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function prettyMerchant(name) {
  if (!name) return '—';
  return String(name).replace(/\s+/g, ' ').trim();
}

/**
 * Build a Telegram-ready summary string for the given date.
 * Returns null if there's nothing to report (no debits today).
 */
async function buildSummary(date) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT date, time, type, amount, merchant, category
     FROM transactions
     WHERE date = $1
       AND hidden = 0
     ORDER BY amount DESC`,
    [date]
  );

  if (rows.length === 0) return null;

  const debits = rows.filter((r) => r.type === 'DEBIT' && r.is_refund !== 1);
  const totalNet = rows.reduce(
    (s, r) => s + (r.type === 'DEBIT' ? Number(r.amount) : -Number(r.amount)),
    0
  );

  const top = debits.slice(0, 2);

  const lines = [];
  lines.push(`Today so far · ${fmtINR(totalNet)}`);
  lines.push(`${debits.length} debit${debits.length === 1 ? '' : 's'}`);

  if (top.length > 0) {
    lines.push('');
    lines.push('Top spend:');
    for (const t of top) {
      const m = prettyMerchant(t.merchant);
      const tag = t.category && t.category !== 'Misc' ? ` · ${t.category}` : '';
      lines.push(`• ${m} — ${fmtINR(Number(t.amount))}${tag}`);
    }
  }

  return lines.join('\n');
}

/**
 * Compute and dispatch the summary. Returns { sent, reason }.
 * Never throws.
 */
export async function sendDailySummary({ date } = {}) {
  try {
    if (!isTelegramConfigured()) {
      return { sent: false, reason: 'telegram_not_configured' };
    }
    const d = date ?? todayInIST();
    const text = await buildSummary(d);
    if (!text) {
      return { sent: false, reason: 'no_transactions' };
    }
    const { ok, error } = await sendTelegramMessage(text);
    return ok
      ? { sent: true, date: d }
      : { sent: false, reason: error ?? 'telegram_failed' };
  } catch (err) {
    console.error('[daily-summary] failed:', err?.message ?? err);
    return { sent: false, reason: 'exception' };
  }
}
