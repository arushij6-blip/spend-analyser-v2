import { NextResponse } from 'next/server';
import { parseStatementPdf } from '../../../src/pdf-statement-parser.js';
import { parseIciciStatementPdf } from '../../../src/icici-pdf-statement-parser.js';
import { categorize } from '../../../src/categorizer.js';
import { getLearnedRules, upsertTransactions } from '../../../lib/db.js';
import { checkAndSendBudgetAlertsAsync } from '../../../lib/budget-alerts.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/upload-pdf  (multipart/form-data, field name: "file")
 *
 * Parses an uploaded credit-card / bank statement PDF, runs each row through
 * the same categorizer used for Gmail-sourced transactions, and writes them
 * into the shared SQLite store.
 */
export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file uploaded (expected field "file")' }, { status: 400 });
    }
    if (file.type && !file.type.includes('pdf') && !file.name?.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Uploaded file is not a PDF' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      // Try HDFC parser first
      parsed = await parseStatementPdf(buffer, { fileName: file.name ?? 'statement.pdf' });

      // If HDFC parser found nothing, try ICICI parser
      if (parsed.transactions.length === 0) {
        console.log('[upload-pdf] HDFC parser found 0 rows, trying ICICI parser...');
        parsed = await parseIciciStatementPdf(buffer, {
          fileName: file.name ?? 'statement.pdf',
          source: 'ICICI Bank'
        });
      }
    } catch (err) {
      console.error('[upload-pdf] parser threw:', err);
      const msg = /password/i.test(err.message)
        ? 'PDF is password-protected. Please upload an unlocked PDF.'
        : `Could not read PDF: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const parserUsed = parsed.source === 'ICICI Bank' ? 'ICICI' : 'HDFC';
    console.log(
      `[upload-pdf] file=${file.name} parser=${parserUsed} pages=${parsed.pageCount} account=${parsed.cardAccount || parsed.accountNumber} parsedRows=${parsed.transactions.length}`
    );

    if (parsed.transactions.length === 0) {
      return NextResponse.json({
        ok: true,
        found: 0,
        written: 0,
        inserted: 0,
        updated: 0,
        message: 'No transactions detected. Is this the right statement format?',
      });
    }

    const learnedRules = await getLearnedRules();
    const rows = [];
    for (const txn of parsed.transactions) {
      const recat = categorize(txn, learnedRules);
      // Mirror runScan: drop non-expense flows so they don't pollute the UI
      // totals. Credit Card Bill payments are excluded too — the underlying
      // purchases are already counted on the card statement, so writing the
      // payment as well double-counts spend.
      if (
        recat.category === 'Self Transfer' ||
        recat.category === 'Investments' ||
        recat.category === 'Credit Card Bill'
      ) continue;
      rows.push({
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
        source: txn.source,
        is_refund: recat.isRefund ? 1 : 0,
      });
    }

    const { inserted, updated } = await upsertTransactions(rows);

    // Best-effort budget alert check after fresh rows land. Non-blocking.
    checkAndSendBudgetAlertsAsync();

    const account = parsed.cardAccount || parsed.accountNumber;
    return NextResponse.json({
      ok: true,
      file: file.name,
      account,
      parser: parserUsed,
      pageCount: parsed.pageCount,
      found: parsed.transactions.length,
      written: rows.length,
      inserted,
      updated,
    });
  } catch (err) {
    console.error('[upload-pdf] route threw:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
