# Spend Analyser v2

A personal expense dashboard. Ingests transactions from two sources:

- **Gmail** — Axis Bank transaction-alert emails (via Gmail API)
- **PDF upload** — HDFC Diners Black credit-card statements (parsed in-browser via `/api/upload-pdf`)

Both sources flow through the same categorizer and write to one SQLite store,
which feeds the Next.js dashboard.

## Stack
- Next.js 15 (App Router) + React 18 + Tailwind CSS
- `better-sqlite3` for persistence (`data/app.db`)
- Gmail API (`googleapis`) with OAuth 2.0 (loopback redirect)

## One-time setup

1. **Install deps**
   ```bash
   npm install
   ```

2. **Create local config**
   ```bash
   cp config.example.js config.local.js
   # edit config.local.js — fill in EMAIL_SOURCE_MAP, SELF_OWNED_ACCOUNTS,
   # STAFF_SALARY_PATTERNS for your situation
   ```

3. **Gmail OAuth credentials** — create a Google Cloud project, enable the
   Gmail API, configure an OAuth consent screen, and create a Desktop-app
   OAuth client. Place the resulting client id/secret in `~/.claude/.env.gmail`:
   ```
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   ```

4. **Authenticate each Gmail account**
   ```bash
   node src/auth.js you@gmail.com
   ```
   Tokens are stored under `~/.gmail-mcp/tokens.json`.

## Running

```bash
npm run dev          # Next.js on http://localhost:3000
node src/fetch-all.js 2025-05-01   # standalone CLI scan → data/transactions.{json,csv}
```

The web UI exposes:
- **Dashboard** — month-by-month KPIs, category breakdown, top transactions
- **Expenses** — full transaction list with category editing
- **Review** — uncategorized (Misc) items needing manual assignment

Top-bar actions:
- **Sync** — pull new transactions from all authenticated Gmail accounts
- **Upload** — pick a PDF statement; rows are parsed, categorized, and merged
  into the same store (re-uploading the same file is idempotent)

## What's gitignored

- `config.local.js` (personal mappings)
- `data/app.db*`, `data/transactions.{json,csv}`, backups
- `.env`, `tokens.json`, `node_modules/`, `.next/`
