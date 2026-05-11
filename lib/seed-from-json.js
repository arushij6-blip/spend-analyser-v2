/**
 * One-off seed script: imports an existing transactions.json file into the
 * SQLite DB. Useful for first-time setup so you don't have to re-scan Gmail
 * (and re-burn your quota) just to populate the UI.
 *
 * Usage:  node lib/seed-from-json.js [path/to/transactions.json]
 *         Default path: data/transactions.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertTransactions } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE = 'Axis common';

const jsonPath =
  process.argv[2] ??
  path.resolve(__dirname, '..', 'data', 'transactions.json');

const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

const rows = raw
  // Self-transfers are not expenses
  .filter((t) => t.category !== 'Self Transfer')
  .map((t) => ({
    message_id: t.messageId ?? t.message_id,
    date: t.date,
    time: t.time,
    type: t.type,
    amount: t.amount,
    currency: t.currency ?? 'INR',
    account: t.account,
    merchant: t.merchant,
    category: t.category,
    auto_category: t.category,
    sub_category: t.subCategory ?? t.sub_category ?? null,
    transaction_id: t.transactionId ?? t.transaction_id,
    bank_handle: t.bankHandle ?? t.bank_handle,
    raw_transaction_info: t.rawTransactionInfo ?? t.raw_transaction_info,
    email_subject: t.emailSubject ?? t.email_subject,
    email_received_at: t.emailReceivedAt ?? t.email_received_at,
    source: SOURCE,
  }))
  .filter((r) => r.message_id); // skip rows missing the PK

const { inserted, updated } = upsertTransactions(rows);
console.log(`Seeded from ${jsonPath}`);
console.log(`  inserted: ${inserted}`);
console.log(`  updated:  ${updated}`);
console.log(`  total in DB after seed: ${rows.length}`);
