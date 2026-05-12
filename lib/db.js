/**
 * SQLite layer — single source of truth for the web UI.
 *
 * Schema:
 *   transactions    : one row per de-duplicated bank txn (PK = messageId)
 *   learned_rules   : merchant pattern → category, learned from user edits
 *
 * better-sqlite3 is synchronous and very fast for local apps. Each call to
 * `getDb()` returns a cached singleton; the DB file lives under data/.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

let cached = null;

export function getDb() {
  if (cached) return cached;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  cached = db;
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      message_id            TEXT PRIMARY KEY,
      date                  TEXT,
      time                  TEXT,
      type                  TEXT NOT NULL,
      amount                REAL NOT NULL,
      currency              TEXT DEFAULT 'INR',
      account               TEXT,
      merchant              TEXT,
      category              TEXT NOT NULL,
      auto_category         TEXT NOT NULL,
      sub_category          TEXT,
      transaction_id        TEXT,
      bank_handle           TEXT,
      raw_transaction_info  TEXT,
      email_subject         TEXT,
      email_received_at     TEXT,
      source                TEXT NOT NULL,
      is_refund             INTEGER NOT NULL DEFAULT 0,
      manually_edited       INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant);

    CREATE TABLE IF NOT EXISTS learned_rules (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_pattern  TEXT NOT NULL UNIQUE,
      category          TEXT NOT NULL,
      created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// -------- transactions --------

/**
 * Upsert a batch of transactions.
 * - If a row with the same message_id already exists AND the user has manually
 *   edited its category, we preserve their edit (only auto_category gets refreshed).
 * - Otherwise we update category to the freshly computed value.
 */
export function upsertTransactions(rows) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO transactions (
      message_id, date, time, type, amount, currency, account, merchant,
      category, auto_category, sub_category, transaction_id, bank_handle,
      raw_transaction_info, email_subject, email_received_at, source, is_refund
    ) VALUES (
      @message_id, @date, @time, @type, @amount, @currency, @account, @merchant,
      @category, @auto_category, @sub_category, @transaction_id, @bank_handle,
      @raw_transaction_info, @email_subject, @email_received_at, @source, @is_refund
    )
    ON CONFLICT(message_id) DO UPDATE SET
      date                 = excluded.date,
      time                 = excluded.time,
      type                 = excluded.type,
      amount               = excluded.amount,
      currency             = excluded.currency,
      account              = excluded.account,
      merchant             = excluded.merchant,
      -- only overwrite category when the user hasn't manually edited it
      category             = CASE WHEN transactions.manually_edited = 1
                                  THEN transactions.category
                                  ELSE excluded.category END,
      auto_category        = excluded.auto_category,
      sub_category         = excluded.sub_category,
      transaction_id       = excluded.transaction_id,
      bank_handle          = excluded.bank_handle,
      raw_transaction_info = excluded.raw_transaction_info,
      email_subject        = excluded.email_subject,
      email_received_at    = excluded.email_received_at,
      source               = excluded.source,
      is_refund            = excluded.is_refund,
      updated_at           = CURRENT_TIMESTAMP
  `);

  const tx = db.transaction((rows) => {
    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const before = db
        .prepare('SELECT message_id FROM transactions WHERE message_id = ?')
        .get(r.message_id);
      insert.run(r);
      if (before) updated++;
      else inserted++;
    }
    return { inserted, updated };
  });
  return tx(rows);
}

export function getAllTransactions() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM transactions
       WHERE date >= '2026-04-01' AND date <= '2026-05-31'
       ORDER BY date DESC, time DESC, amount DESC`
    )
    .all();
}

export function getTransactionsForReview() {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM transactions
       WHERE category = 'Misc'
         AND date >= '2026-04-01' AND date <= '2026-05-31'
       ORDER BY date DESC, amount DESC`
    )
    .all();
}

export function updateCategory(messageId, newCategory, opts = {}) {
  const db = getDb();
  const target = db
    .prepare('SELECT merchant FROM transactions WHERE message_id = ?')
    .get(messageId);

  const result = db
    .prepare(
      `UPDATE transactions
       SET category = ?, manually_edited = 1, updated_at = CURRENT_TIMESTAMP
       WHERE message_id = ?`
    )
    .run(newCategory, messageId);

  let alsoUpdatedIds = [];

  if (opts.learn && target?.merchant) {
    const pattern = target.merchant.toUpperCase().trim();
    // Persist the rule for future scans.
    db.prepare(
      `INSERT INTO learned_rules (merchant_pattern, category)
       VALUES (?, ?)
       ON CONFLICT(merchant_pattern) DO UPDATE SET
         category = excluded.category,
         created_at = CURRENT_TIMESTAMP`
    ).run(pattern, newCategory);

    // Also re-categorize every other Misc row from the same merchant *right now*,
    // so the Review tab clears them in one shot instead of waiting for next scan.
    const others = db
      .prepare(
        `SELECT message_id FROM transactions
         WHERE upper(trim(merchant)) = ?
           AND category = 'Misc'
           AND manually_edited = 0
           AND message_id != ?`
      )
      .all(pattern, messageId);

    if (others.length > 0) {
      const ids = others.map((r) => r.message_id);
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(
        `UPDATE transactions
         SET category = ?, manually_edited = 1, updated_at = CURRENT_TIMESTAMP
         WHERE message_id IN (${placeholders})`
      ).run(newCategory, ...ids);
      alsoUpdatedIds = ids;
    }
  }

  return { changes: result.changes, alsoUpdatedIds };
}

// -------- learned rules --------

export function getLearnedRules() {
  const db = getDb();
  const rows = db.prepare('SELECT merchant_pattern, category FROM learned_rules').all();
  const map = new Map();
  for (const r of rows) map.set(r.merchant_pattern, r.category);
  return map;
}

// -------- monthly trends --------

export function getMonthlyCategoryTotals() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         substr(date, 1, 7) AS month,
         category,
         type,
         SUM(amount) AS total,
         COUNT(*) AS count,
         SUM(CASE WHEN is_refund = 0 THEN 1 ELSE 0 END) AS expense_count,
         SUM(CASE WHEN is_refund = 1 THEN 1 ELSE 0 END) AS refund_count
       FROM transactions
       WHERE date >= '2026-04-01' AND date <= '2026-05-31'
         AND date IS NOT NULL
       GROUP BY month, category, type
       ORDER BY month DESC, total DESC`
    )
    .all();
}
