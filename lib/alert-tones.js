/**
 * Reusable alert tone/style system.
 *
 * Goal: warm, playful, emotionally light copy that nudges instead of nagging.
 * Each threshold has a pool of one-liners; we pick one deterministically per
 * (category, month, threshold) so the same alert always reads the same — but
 * different categories or months get variety.
 *
 * To add a new threshold or tone, just extend POOLS. The orchestrator never
 * hardcodes strings; it only asks `pickTone(threshold, category, month)`.
 *
 * Per project rule #1: keep responsibilities separated — this file knows
 * nothing about Telegram, budgets, or the DB. It is pure copy.
 */

const POOLS = {
  80: [
    (c) => `Tiny update: ${c} is starting to believe in us a little too much this month 🍔`,
    (c) => `We’ve officially entered the ‘maybe cook at home once’ zone for ${c} 😄`,
    (c) => `${c} budget waving from the 80% mark 👋`,
    (c) => `Heads up — ${c} just texted to say it’s “almost there” 😅`,
    (c) => `${c} is doing cardio toward the finish line 🏃‍♀️`,
    (c) => `Friendly nudge: ${c} is 80% through its monthly snack 🍪`,
  ],
  100: [
    (c) => `Well. The ${c} budget fought bravely.`,
    (c) => `${c} has now entered its villain arc 🦹`,
    (c) => `${c} budget has logged off for the month 🫡`,
    (c) => `Plot twist: ${c} ate the whole budget 🍰`,
    (c) => `${c} said “hold my chai” and crossed the line ☕`,
    (c) => `${c} is officially in overtime 🎬`,
  ],
};

/**
 * Stable hash → index. Same inputs always return the same line.
 */
function pickIndex(key, len) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % len;
}

/**
 * Pick a one-liner for a given threshold.
 * @param {number} threshold  80 | 100
 * @param {string} category
 * @param {string} month      'YYYY-MM' — used only to seed the picker
 * @returns {string}
 */
export function pickTone(threshold, category, month) {
  const pool = POOLS[threshold];
  if (!pool || pool.length === 0) {
    return `${category} hit ${threshold}% of its budget.`;
  }
  const idx = pickIndex(`${category}|${month}|${threshold}`, pool.length);
  return pool[idx](category);
}

/**
 * Format the full Telegram message body (one-liner + a single quiet stat line).
 * Kept here so tone + layout live together.
 */
export function formatAlertMessage({ threshold, category, month, spent, budget }) {
  const headline = pickTone(threshold, category, month);
  const pct = Math.round((spent / budget) * 100);
  const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const stat =
    threshold >= 100
      ? `${inr(spent)} of ${inr(budget)} · ${pct}%`
      : `${inr(spent)} of ${inr(budget)} · ${pct}%`;
  return `${headline}\n\n${stat}`;
}
