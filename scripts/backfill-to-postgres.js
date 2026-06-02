#!/usr/bin/env node
/**
 * One-shot backfill: copy every row from the local SQLite DB into Postgres.
 *
 * Run locally, NOT on Vercel. Needs both:
 *   - data/app.db                  (the existing SQLite store)
 *   - DATABASE_URL_UNPOOLED env var (the direct Neon connection string;
 *                                    the pooler will throw on a long-running
 *                                    transaction for a multi-row insert)
 *
 * Usage:
 *   DATABASE_URL_UNPOOLED='postgres://...' node scripts/backfill-to-postgres.js
 *
 * Idempotent — transactions and budgets use ON CONFLICT DO NOTHING, so re-running
 * the script after a partial run picks up where it left off.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.db');

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'Set DATABASE_URL_UNPOOLED (or POSTGRES_URL_NON_POOLING) before running.'
  );
  process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });
const pool = new Pool({
  connectionString,
  ssl: connectionString.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
  max: 1,
});

async function copyTransactions() {
  const rows = sqlite.prepare('SELECT * FROM transactions').all();
  console.log(`  transactions: ${rows.length} rows in SQLite`);

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const result = await client.query(
        `INSERT INTO transactions (
           message_id, date, time, type, amount, currency, account, merchant,
           category, auto_category, sub_category, transaction_id, bank_handle,
           raw_transaction_info, email_subject, email_received_at, source,
           is_refund, manually_edited, hidden
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         ON CONFLICT (message_id) DO NOTHING`,
        [
          r.message_id, r.date, r.time, r.type, r.amount, r.currency,
          r.account, r.merchant, r.category, r.auto_category, r.sub_category,
          r.transaction_id, r.bank_handle, r.raw_transaction_info,
          r.email_subject, r.email_received_at, r.source,
          r.is_refund ?? 0, r.manually_edited ?? 0, r.hidden ?? 0,
        ]
      );
      if (result.rowCount > 0) inserted++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  console.log(`  transactions: inserted ${inserted}, skipped ${rows.length - inserted}`);
}

async function copyLearnedRules() {
  const rows = sqlite.prepare('SELECT merchant_pattern, category FROM learned_rules').all();
  console.log(`  learned_rules: ${rows.length} rows in SQLite`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO learned_rules (merchant_pattern, category)
       VALUES ($1, $2)
       ON CONFLICT (merchant_pattern) DO NOTHING`,
      [r.merchant_pattern, r.category]
    );
  }
}

async function copyBudgets() {
  const rows = sqlite.prepare('SELECT category, month, amount FROM budgets').all();
  console.log(`  budgets: ${rows.length} rows in SQLite`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO budgets (category, month, amount)
       VALUES ($1, $2, $3)
       ON CONFLICT (category, month) DO NOTHING`,
      [r.category, r.month, r.amount]
    );
  }
}

async function copyBudgetAlerts() {
  const rows = sqlite.prepare('SELECT category, month, threshold FROM budget_alerts').all();
  console.log(`  budget_alerts: ${rows.length} rows in SQLite`);
  for (const r of rows) {
    await pool.query(
      `INSERT INTO budget_alerts (category, month, threshold)
       VALUES ($1, $2, $3)
       ON CONFLICT (category, month, threshold) DO NOTHING`,
      [r.category, r.month, r.threshold]
    );
  }
}

async function main() {
  console.log(`Backfilling from ${DB_PATH} → Postgres`);
  await copyLearnedRules();
  await copyTransactions();
  await copyBudgets();
  await copyBudgetAlerts();
  console.log('Done.');
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch((err) => {
    console.error('Backfill failed:', err);
    pool.end().finally(() => process.exit(1));
  });
