/**
 * PDF statement parser — HDFC Diners Black credit card statements.
 *
 * Statement rows look like:
 *   DD/MM/YYYY| HH:MM  DESCRIPTION  [± rewardPts]  [+] C amount  l
 *
 * A leading `+` before the `C` marks a CREDIT (payment received, refund);
 * absent → DEBIT (purchase / EMI installment / fee). Some rows wrap onto
 * a second line — they're joined until the trailing ` l` PI marker is seen.
 *
 * Output objects use the same shape that `categorize()` and `upsertTransactions()`
 * consume, so PDF-sourced rows flow through the existing pipeline.
 */

import crypto from 'node:crypto';
import { PDFParse } from 'pdf-parse';

const ROW_START = /^(\d{2}\/\d{2}\/\d{4})\|\s*(\d{2}:\d{2})\s+/;
// Joined-row parser. Description is greedy-non-greedy with optional reward
// (sign + integer points) and optional `+ ` credit marker before `C`.
const ROW_FULL =
  /^(\d{2}\/\d{2}\/\d{4})\|\s*(\d{2}:\d{2})\s+(.+?)(?:\s+([+-])\s*(\d+))?\s+(\+\s+)?C\s*([\d,]+\.\d{2})\s+l\s*$/;

const SECTION_END_MARKERS = [
  'Eligible for EMI',
  'Rewards Program',
  'GST Summary',
  'Important Information',
  'Past Dues',
  'Offers on your card',
];

function isSectionEnd(line) {
  return SECTION_END_MARKERS.some((m) => line.startsWith(m));
}

function extractCardLast4(text) {
  // Card number printed like `00360886XXXX0525` (16 chars with X mask).
  const m = text.match(/\b\d{4,8}X{2,8}(\d{4})\b/);
  return m ? `XX${m[1]}` : null;
}

function ddmmyyyyToIso(s) {
  const [d, m, y] = s.split('/');
  return `${y}-${m}-${d}`;
}

function cleanMerchant(description) {
  let m = description.trim();
  // Strip leading "EMI " prefix — keeps the underlying merchant for keyword rules.
  m = m.replace(/^EMI\s+/i, '');
  // Strip trailing (Ref# ...) blocks.
  m = m.replace(/\s*\(Ref#[^)]*\)\s*$/i, '');
  return m.trim();
}

function extractRefId(description) {
  const m = description.match(/\(Ref#\s*([^)\s]+)\s*\)/i);
  return m ? m[1] : null;
}

function makeMessageId(fileTag, raw) {
  const h = crypto.createHash('sha256').update(`${fileTag}|${raw}`).digest('hex');
  return `pdf:${fileTag}:${h.slice(0, 16)}`;
}

/**
 * Parse a credit card statement PDF buffer into transaction rows.
 *
 * @param {Buffer} pdfBuffer
 * @param {object} opts
 * @param {string} opts.fileName     - original filename (used for message_id seeding)
 * @param {string} [opts.source]     - source label written to DB (default 'HDFC Credit Card')
 * @returns {Promise<{ transactions: object[], cardAccount: string|null, pageCount: number }>}
 */
export async function parseStatementPdf(pdfBuffer, opts = {}) {
  const fileName = opts.fileName ?? 'statement.pdf';
  const source = opts.source ?? 'HDFC Credit Card';

  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  const text = result.text ?? '';
  const pageCount = result.total ?? result.numpages ?? 0;

  const cardAccount = extractCardLast4(text);

  // Stable per-file tag → idempotent message_ids across re-uploads.
  const fileTag = crypto
    .createHash('sha256')
    .update(fileName + '|' + pdfBuffer.length)
    .digest('hex')
    .slice(0, 10);

  const lines = text.split(/\r?\n/);
  const rawRows = [];
  let current = null;
  let inTxnSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Section gating: only collect rows inside "Domestic Transactions" /
    // "International Transactions" tables. The header row that precedes the
    // table contains "TRANSACTION DESCRIPTION".
    if (line.includes('TRANSACTION DESCRIPTION')) {
      inTxnSection = true;
      if (current) { rawRows.push(current); current = null; }
      continue;
    }
    if (!inTxnSection) continue;

    if (isSectionEnd(line)) {
      if (current) { rawRows.push(current); current = null; }
      inTxnSection = false;
      continue;
    }

    if (ROW_START.test(line)) {
      if (current) rawRows.push(current);
      current = line;
    } else if (current) {
      // Continuation of a wrapped row.
      current += ' ' + line;
    }

    // Close the row as soon as it ends with the trailing PI marker " l".
    if (current && /\sl\s*$/.test(current) && ROW_FULL.test(current)) {
      rawRows.push(current);
      current = null;
    }
  }
  if (current) rawRows.push(current);

  const transactions = [];
  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i].replace(/\s+/g, ' ').trim();
    const m = ROW_FULL.exec(raw);
    if (!m) continue;
    const [, dateDmy, hhmm, description, , , creditMarker, amountStr] = m;

    const isCredit = !!creditMarker;
    const amount = parseFloat(amountStr.replace(/,/g, ''));
    if (!isFinite(amount)) continue;

    const merchant = cleanMerchant(description);
    const transactionId = extractRefId(description);

    transactions.push({
      messageId: makeMessageId(fileTag, raw),
      date: ddmmyyyyToIso(dateDmy),
      time: `${hhmm}:00`,
      type: isCredit ? 'CREDIT' : 'DEBIT',
      amount,
      currency: 'INR',
      account: cardAccount,
      merchant,
      // Shape-category — falls through the categorizer's keyword/learned rules
      // exactly like email-sourced rows whose initial category isn't matched.
      category: isCredit ? 'CC-CREDIT' : 'CC-PURCHASE',
      subCategory: null,
      transactionId,
      bankHandle: null,
      rawTransactionInfo: raw,
      emailSubject: fileName,
      emailReceivedAt: new Date().toISOString(),
      source,
    });
  }

  return { transactions, cardAccount, pageCount };
}
