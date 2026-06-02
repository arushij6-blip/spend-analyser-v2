/**
 * Postgres layer — single source of truth for the web UI.
 *
 * Schema is owned by db/schema.sql (paste into Neon SQL editor on first
 * deploy). This module only reads and writes rows; it does not migrate.
 *
 * Pooling: we create one shared `pg.Pool`. On Vercel each cold-start gets
 * its own pool, which is fine because the connection string from Neon's
 * integration already points at the connection pooler — Pool-on-pooler is
 * intentional and safe for serverless.
 */

import pg from 'pg';

const { Pool } = pg;

let cached = null;

/**
 * Get the shared connection pool. Lazily initialised so `import` of this
 * module from a script that doesn't actually query the DB doesn't crash on
 * a missing env var.
 */
export function getPool() {
  if (cached) return cached;
  const connectionString =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!connectionString) {
    throw new Error(
      'No Postgres connection string set. Expected DATABASE_URL (Neon) or POSTGRES_URL (Vercel Postgres legacy).'
    );
  }
  cached = new Pool({
    connectionString,
    // Neon serverless requires SSL; pg auto-detects from the URL but we
    // belt-and-brace it for self-hosted Postgres without sslmode.
    ssl: connectionString.includes('sslmode=') ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
  return cached;
}

async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

// -------- budgets --------

export async function getBudgetsForMonth(month) {
  const { rows } = await query(
    'SELECT category, month, amount FROM budgets WHERE month = $1',
    [month]
  );
  return rows;
}

export async function upsertBudget(category, month, amount) {
  await query(
    `INSERT INTO budgets (category, month, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (category, month) DO UPDATE SET
       amount = EXCLUDED.amount,
       updated_at = NOW()`,
    [category, month, amount]
  );
}

export async function deleteBudget(category, month) {
  await query('DELETE FROM budgets WHERE category = $1 AND month = $2', [
    category,
    month,
  ]);
}

/**
 * Net spend per category for a given month: DEBIT − CREDIT (same convention
 * as Trends/Dashboard). Returns a Map<category, number>.
 */
export async function getCategorySpendForMonth(month) {
  const { rows } = await query(
    `SELECT category,
            SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE -amount END) AS net
     FROM transactions
     WHERE substr(date, 1, 7) = $1
       AND hidden = 0
     GROUP BY category`,
    [month]
  );
  const map = new Map();
  for (const r of rows) map.set(r.category, Number(r.net) ?? 0);
  return map;
}

// -------- budget alerts (dedup within a month) --------

export async function wasAlertSent(category, month, threshold) {
  const { rows } = await query(
    'SELECT 1 AS x FROM budget_alerts WHERE category = $1 AND month = $2 AND threshold = $3',
    [category, month, threshold]
  );
  return rows.length > 0;
}

export async function markAlertSent(category, month, threshold) {
  await query(
    `INSERT INTO budget_alerts (category, month, threshold)
     VALUES ($1, $2, $3)
     ON CONFLICT (category, month, threshold) DO NOTHING`,
    [category, month, threshold]
  );
}

// -------- transactions --------

/**
 * Upsert a batch of transactions.
 * - If a row with the same message_id already exists AND the user has manually
 *   edited its category, we preserve their edit (only auto_category gets refreshed).
 * - Otherwise we update category to the freshly computed value.
 */
export async function upsertTransactions(rows) {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const result = await client.query(
        `INSERT INTO transactions (
           message_id, date, time, type, amount, currency, account, merchant,
           category, auto_category, sub_category, transaction_id, bank_handle,
           raw_transaction_info, email_subject, email_received_at, source, is_refund
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18
         )
         ON CONFLICT (message_id) DO UPDATE SET
           date                 = EXCLUDED.date,
           time                 = EXCLUDED.time,
           type                 = EXCLUDED.type,
           amount               = EXCLUDED.amount,
           currency             = EXCLUDED.currency,
           account              = EXCLUDED.account,
           merchant             = EXCLUDED.merchant,
           category             = CASE WHEN transactions.manually_edited = 1
                                       THEN transactions.category
                                       ELSE EXCLUDED.category END,
           auto_category        = EXCLUDED.auto_category,
           sub_category         = EXCLUDED.sub_category,
           transaction_id       = EXCLUDED.transaction_id,
           bank_handle          = EXCLUDED.bank_handle,
           raw_transaction_info = EXCLUDED.raw_transaction_info,
           email_subject        = EXCLUDED.email_subject,
           email_received_at    = EXCLUDED.email_received_at,
           source               = EXCLUDED.source,
           is_refund            = EXCLUDED.is_refund,
           updated_at           = NOW()
         RETURNING (xmax = 0) AS was_inserted`,
        [
          r.message_id, r.date, r.time, r.type, r.amount, r.currency, r.account, r.merchant,
          r.category, r.auto_category, r.sub_category, r.transaction_id, r.bank_handle,
          r.raw_transaction_info, r.email_subject, r.email_received_at, r.source, r.is_refund,
        ]
      );
      if (result.rows[0]?.was_inserted) inserted++;
      else updated++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { inserted, updated };
}

export async function getAllTransactions() {
  const { rows } = await query(
    `SELECT * FROM transactions
     WHERE date >= '2026-04-01'
       AND hidden = 0
     ORDER BY date DESC, time DESC, amount DESC`
  );
  return rows;
}

export async function getTopTransactionsForCategoryMonth(category, month, limit = 5) {
  const { rows } = await query(
    `SELECT * FROM transactions
     WHERE category = $1
       AND substr(date, 1, 7) = $2
       AND type = 'DEBIT'
       AND is_refund = 0
       AND hidden = 0
     ORDER BY amount DESC
     LIMIT $3`,
    [category, month, limit]
  );
  return rows;
}

export async function getTransactionsForReview() {
  const { rows } = await query(
    `SELECT * FROM transactions
     WHERE category = 'Misc'
       AND date >= '2026-04-01'
       AND hidden = 0
     ORDER BY date DESC, amount DESC`
  );
  return rows;
}

export async function updateCategory(messageId, newCategory, opts = {}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: targetRows } = await client.query(
      'SELECT merchant FROM transactions WHERE message_id = $1',
      [messageId]
    );
    const target = targetRows[0];

    const result = await client.query(
      `UPDATE transactions
       SET category = $1, manually_edited = 1, updated_at = NOW()
       WHERE message_id = $2`,
      [newCategory, messageId]
    );

    let alsoUpdatedIds = [];
    if (opts.learn && target?.merchant) {
      const pattern = target.merchant.toUpperCase().trim();
      await client.query(
        `INSERT INTO learned_rules (merchant_pattern, category)
         VALUES ($1, $2)
         ON CONFLICT (merchant_pattern) DO UPDATE SET
           category = EXCLUDED.category,
           created_at = NOW()`,
        [pattern, newCategory]
      );

      const { rows: others } = await client.query(
        `SELECT message_id FROM transactions
         WHERE upper(trim(merchant)) = $1
           AND category = 'Misc'
           AND manually_edited = 0
           AND message_id <> $2`,
        [pattern, messageId]
      );
      if (others.length > 0) {
        const ids = others.map((r) => r.message_id);
        await client.query(
          `UPDATE transactions
           SET category = $1, manually_edited = 1, updated_at = NOW()
           WHERE message_id = ANY($2::text[])`,
          [newCategory, ids]
        );
        alsoUpdatedIds = ids;
      }
    }

    await client.query('COMMIT');
    return { changes: result.rowCount, alsoUpdatedIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function setTransactionHidden(messageId, hidden) {
  const result = await query(
    `UPDATE transactions
     SET hidden = $1, updated_at = NOW()
     WHERE message_id = $2`,
    [hidden ? 1 : 0, messageId]
  );
  return { changes: result.rowCount };
}

// -------- learned rules --------

export async function getLearnedRules() {
  const { rows } = await query(
    'SELECT merchant_pattern, category FROM learned_rules'
  );
  const map = new Map();
  for (const r of rows) map.set(r.merchant_pattern, r.category);
  return map;
}

// -------- monthly trends --------

export async function getMonthlyCategoryTotals() {
  const { rows } = await query(
    `SELECT
       substr(date, 1, 7) AS month,
       category,
       type,
       SUM(amount) AS total,
       COUNT(*) AS count,
       SUM(CASE WHEN is_refund = 0 THEN 1 ELSE 0 END) AS expense_count,
       SUM(CASE WHEN is_refund = 1 THEN 1 ELSE 0 END) AS refund_count
     FROM transactions
     WHERE date >= '2026-04-01'
       AND date IS NOT NULL
       AND hidden = 0
     GROUP BY month, category, type
     ORDER BY month DESC, total DESC`
  );
  // Postgres returns numerics as strings — normalize so JSX math stays numeric.
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
    count: Number(r.count),
    expense_count: Number(r.expense_count),
    refund_count: Number(r.refund_count),
  }));
}
