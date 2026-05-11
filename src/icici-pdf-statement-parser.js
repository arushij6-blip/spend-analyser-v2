/**
 * PDF statement parser — ICICI Bank savings account statements.
 *
 * Looks for rows matching: S No | Date | ... Amounts | Balance
 * Transactions can span multiple lines; we accumulate until we see amount columns.
 */

import crypto from 'node:crypto';
import { PDFParse } from 'pdf-parse';

const ACCOUNT_PATTERN = /Saving Account no\.\s+(\d+)/;

function extractAccountNumber(text) {
  const m = text.match(ACCOUNT_PATTERN);
  return m ? m[1] : null;
}

function ddmmyyyyToIso(s) {
  const [d, m, y] = s.split('.');
  return `${y}-${m}-${d}`;
}

function cleanMerchant(description) {
  let m = description.trim();
  m = m.replace(/\/ICI[a-f0-9]+\/?/gi, '');
  m = m.replace(/\/ICl[a-f0-9]+\/?/gi, '');
  m = m.replace(/\/[a-z0-9.@]+@[a-z]+/gi, '');
  m = m.replace(/\/[A-Z0-9]+\//g, ' ');
  m = m.replace(/\s+/g, ' ').trim();
  return m;
}

function makeMessageId(fileTag, rowNum, date) {
  const h = crypto.createHash('sha256').update(`${fileTag}|${rowNum}|${date}`).digest('hex');
  return `pdf:${fileTag}:${h.slice(0, 16)}`;
}

export async function parseIciciStatementPdf(pdfBuffer, opts = {}) {
  const fileName = opts.fileName ?? 'statement.pdf';
  const source = opts.source ?? 'ICICI Bank';

  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  const text = result.text ?? '';
  const pageCount = result.total ?? result.numpages ?? 0;

  const accountNumber = extractAccountNumber(text);

  const fileTag = crypto
    .createHash('sha256')
    .update(fileName + '|' + pdfBuffer.length)
    .digest('hex')
    .slice(0, 10);

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  const transactions = [];

  // First pass: collect raw transactions with amounts and balance
  const rawTxns = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Stop at footers
    if (/^(Never share|www\.|Dial your|Please call|Important Information|Team ICICI|Sincrely)/.test(line)) {
      i++;
      continue;
    }

    // Check for transaction start: S No | Date | merchant/details
    const txnMatch = line.match(/^(\d+)\s+(\d{2}\.\d{2}\.\d{4})\s+(.+)/);
    if (!txnMatch) {
      i++;
      continue;
    }

    const [, sNo, dateStr, merchantStart] = txnMatch;
    let merchant = merchantStart;
    let j = i + 1;
    let amount = null;
    let balance = null;

    // Accumulate lines until we find the amounts
    while (j < lines.length && j - i < 15) {
      const nextLine = lines[j];

      if (/^(Never share|www\.|Dial your|Please call|Important|Team ICICI|Sincrely)/.test(nextLine) ||
          /^(\d+)\s+(\d{2}\.\d{2}\.\d{4})/.test(nextLine)) {
        break;
      }

      // Two amounts on a line: first is withdrawal/deposit, second is balance
      const twoAmounts = nextLine.match(/^([\d,]+\.?\d{0,2})\s+([\d,]+\.?\d{0,2})$/);
      if (twoAmounts) {
        amount = parseFloat(twoAmounts[1].replace(/,/g, ''));
        balance = parseFloat(twoAmounts[2].replace(/,/g, ''));
        j++;
        break;
      }

      // Single amount = just balance (rare)
      const oneAmount = nextLine.match(/^([\d,]+\.?\d{0,2})$/);
      if (oneAmount) {
        balance = parseFloat(oneAmount[1].replace(/,/g, ''));
        j++;
        break;
      }

      merchant += ' ' + nextLine;
      j++;
    }

    if (balance !== null && balance > 0) {
      rawTxns.push({
        sNo, dateStr, merchant, amount, balance,
        rawLines: lines.slice(i, j).join(' '),
      });
    }

    i = j || i + 1;
  }

  // Second pass: determine CREDIT vs DEBIT by comparing balance changes
  let prevBalance = null;
  for (const t of rawTxns) {
    let type = 'DEBIT';
    if (prevBalance !== null && t.amount !== null) {
      const diff = t.balance - prevBalance;
      // If balance increased by approximately the amount → CREDIT
      if (Math.abs(diff - t.amount) < 0.1) {
        type = 'CREDIT';
      } else if (Math.abs(diff + t.amount) < 0.1) {
        type = 'DEBIT';
      }
    }

    const cleanedMerchant = cleanMerchant(t.merchant);
    if (!cleanedMerchant || t.amount === null || t.amount <= 0) {
      prevBalance = t.balance;
      continue;
    }

    transactions.push({
      messageId: makeMessageId(fileTag, t.sNo, t.dateStr),
      date: ddmmyyyyToIso(t.dateStr),
      time: '00:00:00',
      type,
      amount: t.amount,
      currency: 'INR',
      account: accountNumber,
      merchant: cleanedMerchant,
      category: type === 'DEBIT' ? 'Bank-Debit' : 'Bank-Credit',
      subCategory: null,
      transactionId: null,
      bankHandle: null,
      rawTransactionInfo: t.rawLines,
      emailSubject: fileName,
      emailReceivedAt: new Date().toISOString(),
      source,
    });

    prevBalance = t.balance;
  }

  return { transactions, accountNumber, pageCount };
}
