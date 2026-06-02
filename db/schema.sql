-- Postgres schema for spend-analyser-v2.
-- Paste this into the Neon SQL editor (Vercel dashboard → Storage → your DB → Query).
-- Safe to re-run: every CREATE is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS transactions (
  message_id            TEXT PRIMARY KEY,
  date                  TEXT,
  time                  TEXT,
  type                  TEXT NOT NULL,
  amount                DOUBLE PRECISION NOT NULL,
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
  is_refund             SMALLINT NOT NULL DEFAULT 0,
  manually_edited       SMALLINT NOT NULL DEFAULT 0,
  hidden                SMALLINT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_txn_date     ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant);

CREATE TABLE IF NOT EXISTS learned_rules (
  id                BIGSERIAL PRIMARY KEY,
  merchant_pattern  TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budgets (
  category    TEXT NOT NULL,
  month       TEXT NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, month)
);

CREATE TABLE IF NOT EXISTS budget_alerts (
  category    TEXT NOT NULL,
  month       TEXT NOT NULL,
  threshold   INTEGER NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, month, threshold)
);
