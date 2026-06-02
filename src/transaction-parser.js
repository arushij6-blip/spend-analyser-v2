/**
 * Parses Axis Bank transaction alert emails.
 *
 * Two main email shapes:
 *
 *   1) Debit / credit alerts from alerts@axisbank.com — structured "Here's the
 *      summary of your transaction" rows with these labelled fields:
 *         Amount Debited / Amount Credited : INR 502.00
 *         Account Number                   : XX4638
 *         Date & Time                      : 19-12-25, 15:13:30 IST
 *         Transaction Info                 : UPI/P2M/{id}/{MERCHANT}/{bank}
 *
 *   2) Self-transfer credit alerts — free-form text "...credited with INR 7500.00
 *      on 22-12-2025 at 12:47:30 IST by MOB/SELFFT/..."
 *
 * Axis Bank HTML is heavily entity-double-encoded (`&amp;amp;amp;...nbsp;`),
 * so the decoder iterates until the string stops changing.
 */

/**
 * Decode common HTML entities. Iterates because Axis Bank's templates nest
 * entities multiple levels deep (`&amp;amp;...amp;nbsp;` is common).
 */
function decodeEntities(s) {
  let prev;
  let cur = s;
  let safety = 10;
  do {
    prev = cur;
    cur = cur
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
  } while (cur !== prev && --safety > 0);
  return cur;
}

/**
 * Convert HTML to a normalized plaintext block.
 * - Decode entities first so encoded tags become real tags we can strip
 * - Remove <style> / <script> / <!-- --> blocks
 * - Replace block-level tags with newlines so labels stay on their own line
 * - Strip remaining tags
 * - Collapse whitespace (incl. non-breaking space U+00A0)
 */
export function htmlToText(html) {
  if (!html) return '';
  let s = decodeEntities(html);
  s = s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(br|p|div|tr|li|td|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/\r/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Extract the value following a labelled row (case-insensitive).
 * Returns the trimmed line content or null.
 */
function extractLabel(text, label) {
  const re = new RegExp(`${label}\\s*[:\\-]\\s*(.+?)(?:\\n|$)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** Parse "INR 502.00" → 502.00. Tolerant of commas, spaces. */
function parseAmount(str) {
  if (!str) return null;
  const m = str.match(/INR\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  return Number.parseFloat(m[1].replace(/,/g, ''));
}

/** Parse "19-12-25, 15:13:30 IST" → { date: '2025-12-19', time: '15:13:30' } */
function parseDateTime(str) {
  if (!str) return { date: null, time: null };
  // DD-MM-YY, HH:MM:SS
  let m = str.match(/(\d{2})-(\d{2})-(\d{2}),?\s*(\d{2}:\d{2}:\d{2})/);
  if (m) {
    const [, dd, mm, yy, time] = m;
    return { date: `20${yy}-${mm}-${dd}`, time };
  }
  // DD-MM-YYYY at HH:MM:SS (self-transfer form)
  m = str.match(/(\d{2})-(\d{2})-(\d{4})\s*(?:at\s+)?(\d{2}:\d{2}:\d{2})/);
  if (m) {
    const [, dd, mm, yyyy, time] = m;
    return { date: `${yyyy}-${mm}-${dd}`, time };
  }
  return { date: null, time: null };
}

/**
 * Parse email header Date (RFC 2822) as fallback for transaction date.
 * Format: "Fri, 08 May 2026 10:39:32 +0530"
 * Returns YYYY-MM-DD.
 */
function parseDateFromEmailHeader(emailDate) {
  if (!emailDate) return null;
  // Match: DD Month YYYY (day name is optional)
  const m = emailDate.match(/(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})/);
  if (!m) return null;
  const [, day, monthStr, year] = m;
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };
  const month = months[monthStr];
  if (!month) return null;
  const dd = String(day).padStart(2, '0');
  return `${year}-${month}-${dd}`;
}

/**
 * Split the "Transaction Info" string into structured fields.
 * Returns { category, merchant, rawInfo, transactionId, bankHandle }.
 *
 * Known Axis shapes:
 *   UPI/P2M/{id}/{merchant}/{bank}/...        → person-to-merchant
 *   UPI/P2A/{id}/{name}/{bank}/...            → person-to-account
 *   UPI/{id}/{merchant}/{bank}                → older format
 *   MOB/SELFFT/{name}/{...}                   → self-transfer
 *   MOB-TD/{account}/{name}                   → mobile term-deposit / self-transfer
 *   NEFT/IMPS/RTGS/{...}                      → other channels
 */

/**
 * Known self-owned account numbers. Any MOB-TD transfer to these accounts is
 * a self-transfer and not an expense (e.g., moving money to one's own
 * fixed/term deposit). Configured in config.local.js.
 */
import { SELF_OWNED_ACCOUNTS } from '../config.local.js';
export function parseTransactionInfo(info) {
  if (!info) return { category: null, merchant: null, rawInfo: null };
  const raw = info.trim();
  const segments = raw
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let category = null;
  let merchant = null;
  let transactionId = null;
  let bankHandle = null;

  if (segments.length === 0) {
    return { category: null, merchant: null, rawInfo: raw };
  }

  const top = segments[0].toUpperCase();
  const second = (segments[1] ?? '').toUpperCase();

  if (top === 'UPI' && (second === 'P2M' || second === 'P2A')) {
    category = second === 'P2M' ? 'UPI-P2M' : 'UPI-P2A';
    transactionId = segments[2] ?? null;
    merchant = segments[3] ?? null;
    bankHandle = segments[4] ?? null;
  } else if (top === 'IMPS' && (second === 'P2M' || second === 'P2A')) {
    // IMPS has same structure as UPI: IMPS/P2A/id/merchant
    category = `IMPS-${second}`;
    transactionId = segments[2] ?? null;
    merchant = segments[3] ?? null;
    bankHandle = segments[4] ?? null;
  } else if (top === 'UPI') {
    category = 'UPI';
    transactionId = segments[1] ?? null;
    merchant = segments[2] ?? null;
    bankHandle = segments[3] ?? null;
  } else if (top === 'MOB' && second === 'SELFFT') {
    category = 'SELF-TRANSFER';
    merchant = segments[2] ?? 'Self';
  } else if (top === 'MOB-TD') {
    // MOB-TD/{account}/{name} — mobile term-deposit movement.
    // If the destination account belongs to the user, treat as self-transfer.
    const destAccount = segments[1] ?? '';
    const destName = segments.slice(2).join(' ').trim() || 'Self';
    if (SELF_OWNED_ACCOUNTS.has(destAccount)) {
      category = 'SELF-TRANSFER';
      merchant = destName || 'Self';
    } else {
      category = 'MOB-TD';
      merchant = destName || destAccount || null;
    }
    transactionId = destAccount || null;
  } else if (top === 'PUR' || top === 'ECOM') {
    // PUR/<merchant>/<ref1>/<ref2> — Axis card purchase (POS or e-commerce).
    // Example: PUR/NUMASTAYS GB/000000000734582/614386824726
    category = top;
    merchant = segments[1] ?? null;
    transactionId = segments[3] ?? segments[2] ?? null;
  } else if (['NEFT', 'IMPS', 'RTGS', 'ATM', 'POS'].includes(top)) {
    category = top;
    merchant = segments[1] ?? null;
  } else {
    category = top || 'UNKNOWN';
    merchant = segments[1] ?? null;
  }

  return { category, merchant, rawInfo: raw, transactionId, bankHandle };
}

/**
 * Main entry: parse a full Axis Bank alert email.
 * Returns a structured object, or null if this doesn't look like a transaction.
 */
export function parseAxisTransactionEmail({ html, plaintext, subject, date }) {
  const text = htmlToText(html ?? '') || (plaintext ?? '');

  // Identify transaction type
  let type = null;
  let amount = null;

  const debitLine = extractLabel(text, 'Amount Debited');
  const creditLine = extractLabel(text, 'Amount Credited');

  if (debitLine) {
    type = 'DEBIT';
    amount = parseAmount(debitLine);
  } else if (creditLine) {
    type = 'CREDIT';
    amount = parseAmount(creditLine);
  } else {
    // Free-form: "...credited with INR 7500.00..." / "...debited with INR..."
    const ftDebit = text.match(/debited\s+with\s+(INR\s*[\d,]+(?:\.\d+)?)/i);
    const ftCredit = text.match(/credited\s+with\s+(INR\s*[\d,]+(?:\.\d+)?)/i);
    if (ftDebit) {
      type = 'DEBIT';
      amount = parseAmount(ftDebit[1]);
    } else if (ftCredit) {
      type = 'CREDIT';
      amount = parseAmount(ftCredit[1]);
    } else {
      // POS / card-purchase format: "INR 69910.85 has been debited from your A/c..."
      // (also handles credited-to variants, e.g. refunds posted as credits)
      const posDebit = text.match(
        /(INR\s*[\d,]+(?:\.\d+)?)\s+has\s+been\s+debited\s+from\s+your\s+A\/c/i
      );
      const posCredit = text.match(
        /(INR\s*[\d,]+(?:\.\d+)?)\s+has\s+been\s+credited\s+to\s+your\s+A\/c/i
      );
      if (posDebit) {
        type = 'DEBIT';
        amount = parseAmount(posDebit[1]);
      } else if (posCredit) {
        type = 'CREDIT';
        amount = parseAmount(posCredit[1]);
      }
    }
  }

  if (!type || amount == null) return null;

  // Account: structured label or free-form ("A/c no. XX4638")
  let account = extractLabel(text, 'Account Number');
  if (!account) {
    const acctMatch = text.match(/A\/c(?:\s+no\.?)?\s+(XX\d+)/i);
    if (acctMatch) account = acctMatch[1];
  }

  // Date & time: structured label or "on DD-MM-YYYY at HH:MM:SS"
  let dateTimeStr =
    extractLabel(text, 'Date & Time') ?? extractLabel(text, 'Date and Time');
  if (!dateTimeStr) {
    // Accept either "on DD-MM-YYYY at HH:MM:SS" (UPI alerts) or
    // "on DD-MM-YYYY HH:MM:SS" (POS / card-purchase alerts — no "at").
    const dtMatch = text.match(
      /on\s+(\d{2}-\d{2}-\d{4})\s+(?:at\s+)?(\d{2}:\d{2}:\d{2})/i
    );
    if (dtMatch) dateTimeStr = `${dtMatch[1]} ${dtMatch[2]}`;
  }
  let { date: txnDate, time: txnTime } = parseDateTime(dateTimeStr);

  // Fallback: if no date extracted from email body, use email header date
  if (!txnDate && date) {
    txnDate = parseDateFromEmailHeader(date);
  }

  // Transaction Info: structured label or "by ..." in free-form alerts
  let infoStr = extractLabel(text, 'Transaction Info');
  if (!infoStr) {
    const byMatch = text.match(/by\s+([A-Z][A-Z0-9/_\-.\s]+)/);
    if (byMatch) infoStr = byMatch[1].trim();
  }
  // POS / card-purchase alerts use "at PUR/<merchant>/<refs>" (no "by").
  // Also seen: "at ATM/...", "at POS/...", "at ECOM/...". Match the channel
  // prefix explicitly so we don't accidentally swallow trailing English prose.
  if (!infoStr) {
    const atMatch = text.match(
      /\bat\s+((?:PUR|POS|ATM|ECOM|NEFT|IMPS|RTGS)\/[A-Z0-9/_\-.\s]+?)(?=\.\s|\.\s*Available|\s*Available\s+balance|\s*\.|$)/i
    );
    if (atMatch) infoStr = atMatch[1].trim().replace(/\s+/g, ' ');
  }
  const info = parseTransactionInfo(infoStr);

  return {
    type,
    amount,
    currency: 'INR',
    date: txnDate,
    time: txnTime,
    account,
    category: info.category,
    merchant: info.merchant,
    transactionId: info.transactionId,
    bankHandle: info.bankHandle,
    rawTransactionInfo: info.rawInfo,
    emailSubject: subject,
    emailReceivedAt: date,
  };
}
