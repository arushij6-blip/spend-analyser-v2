# Spend Analyser v2 — Project Knowledge File

## Purpose
A personal spend analyser that ingests transactions from multiple sources, categorizes them through a shared rules pipeline, persists them in SQLite, and visualizes spending in a Next.js dashboard.

Currently supported ingest sources:
1. **Gmail** — Axis Bank transaction-alert emails, fetched via the Gmail API
2. **PDF upload** — HDFC Diners Black credit-card statement PDFs, parsed server-side

(Started life as `axis-email-reader`; renamed to `spend-analyser-v2` once the
PDF upload path landed and the scope went beyond Axis emails. The on-disk
directory is still `axis-email-reader/` for now — only the project name and
docs were renamed.)

## Why This Project Exists
The claude.ai Gmail MCP connector only returns plaintext body content from emails. Axis Bank transaction alerts are HTML-only emails (no plaintext alternative MIME part), so the connector returns only truncated snippets — the merchant name is cut off.

This project calls the Gmail API directly with `format=full` to retrieve the HTML body of every transaction email and parses the full "Transaction Info" line.

HDFC credit-card spend never hits the Gmail parser (HDFC alerts use a different
format and many small CC charges don't trigger alerts at all). The PDF upload
path covers that gap: drop in the monthly statement and the dashboard reflects
both Axis savings and HDFC credit-card spend under one set of categories.

## Architecture

```
spend-analyser-v2/ (dir still named axis-email-reader)
├── package.json                # name: spend-analyser-v2
├── .gitignore                  # Excludes node_modules, .env, tokens.json, data/app.db*
├── spend_analyser_v2_main.md   # This file - project knowledge
├── src/
│   ├── auth.js                 # OAuth 2.0 flow for Gmail (one-time, browser-based)
│   ├── gmail-client.js         # Gmail API wrapper for fetching messages
│   ├── transaction-parser.js   # Parses Axis email HTML → transaction fields
│   ├── pdf-statement-parser.js # Parses HDFC Diners CC PDFs → transaction fields
│   ├── categorizer.js          # Shared rules pipeline (keywords + learned rules)
│   ├── fetch-all.js            # CLI: scan all authenticated Gmail accounts
│   └── validate-one.js         # CLI: fetch ONE email, sanity-check parser output
├── app/
│   ├── page.jsx                # Dashboard shell (TopBar with Sync + Upload, tabs)
│   ├── components/             # Dashboard / Expenses / Review / Trends tabs
│   └── api/
│       ├── scan/route.js       # POST → run Gmail scan
│       ├── upload-pdf/route.js # POST (multipart) → parse PDF, categorize, upsert
│       ├── transactions/       # GET list / PATCH category
│       └── trends/             # GET monthly category totals
├── lib/
│   ├── db.js                   # SQLite layer (better-sqlite3, single source of truth)
│   └── scan.js                 # runScan() — used by /api/scan and future CLI
└── data/
    └── app.db                  # SQLite store (gitignored)
```

## Tech Stack
- **Node.js (ESM)** — Runtime
- **Next.js 15** (App Router) + React 18 + Tailwind — Dashboard UI
- **better-sqlite3** — Local persistence (`data/app.db`)
- **googleapis** — Google's official Node.js client for Gmail API
- **pdf-parse** (v2.x) — Server-side PDF text extraction for statement uploads
- **dotenv** — Load credentials from `.env` (gitignored)

## Security & Privacy
Following project principle #2 (never expose secrets):
- OAuth credentials (`client_id`, `client_secret`) loaded from `~/.claude/.env.gmail` — not committed
- OAuth tokens (`access_token`, `refresh_token`) stored in `~/.gmail-mcp/tokens.json` — not committed
- `.gitignore` excludes `.env`, `tokens.json`, `node_modules`
- Tokens never printed to logs or stdout

## OAuth Flow
1. Read `client_id` / `client_secret` from `~/.claude/.env.gmail`
2. Start local HTTP server on `http://localhost:8080/callback` (loopback redirect — preferred for desktop apps)
3. Open browser to Google OAuth consent screen
4. User authorizes scope: `https://www.googleapis.com/auth/gmail.readonly`
5. Capture authorization code from callback redirect
6. Exchange code for `access_token` + `refresh_token`
7. Save tokens to `~/.gmail-mcp/tokens.json`
8. Future runs reuse refresh token (no browser needed)

## Transaction Parsing Logic
Axis Bank alert email HTML contains structured rows. The transaction info line looks like:
```
Transaction Info: UPI/P2M/{transaction_id}/{MERCHANT_NAME}/{bank_handle}
```
or
```
Transaction Info: UPI/P2A/{transaction_id}/{PERSON_NAME}/{bank_handle}
```
or
```
Transaction Info: MOB/SELFFT/{...}
```

Parser extracts:
- **Date** (DD-MM-YYYY)
- **Time** (HH:MM:SS IST)
- **Amount** (INR, debit/credit)
- **Account Number** (XX-masked)
- **Transaction Type** (DEBIT / CREDIT)
- **Category** (UPI-P2M / UPI-P2A / SELF-TRANSFER / etc.)
- **Merchant / Counterparty Name**
- **Raw Transaction Info** (full string for audit)

## PDF Statement Ingest (HDFC Diners Black)

Triggered from the dashboard's **Upload** button (next to Sync). The user picks
a PDF, the file is POSTed multipart to `/api/upload-pdf`, and the route runs:

1. `parseStatementPdf(buffer)` in `src/pdf-statement-parser.js`
   - Extracts text via `pdf-parse` (no temp files; buffer in-memory)
   - Locates the "Domestic Transactions" / "International Transactions" tables
     by scanning for the `TRANSACTION DESCRIPTION` header
   - Joins wrapped rows (e.g. IGST / BPPY entries that break across two PDF
     lines) by accumulating until the trailing PI marker ` l` is seen
   - Parses each row with a single regex; `+ ` before `C` ⇒ CREDIT,
     otherwise DEBIT
   - Card last-4 extracted from the masked card number in the page header
     (`00360886XXXX0525` → `XX0525`)
2. Each parsed row goes through the same `categorize()` used for Gmail rows
   (so merchant keywords / learned rules / Daily Commute window all apply)
3. `upsertTransactions()` writes them — `message_id` is `pdf:<fileTag>:<rowHash>`
   so re-uploading the same PDF is idempotent and never produces duplicates

Currently the only supported PDF format is **HDFC Diners Black**. The header
row signature (`DATE & TIME TRANSACTION DESCRIPTION REWARDS AMOUNT PI`) is the
implicit format detector; other issuers will need their own parser.

Passwords: not supported. Users must upload unlocked PDFs. (Locked uploads
return a clear error from the route.)

## Validation Approach
Per principle #5:
1. `validate-one.js` fetches the most recent Axis transaction email
2. Prints the raw HTML body (first 2000 chars) for inspection
3. Prints the parsed result as a JSON object
4. User confirms parsing is correct
5. THEN scale to all emails from 2025-05-01

## Date Range Target
- Start: configurable via CLI arg (default 2025-05-01)
- End: current date
- Senders to include for transaction alerts:
  - `alerts@axisbank.com`  — legacy domain, used through Dec 22, 2025
  - `alerts@axis.bank.in`  — new domain, Jan 2026 onwards (Axis migrated alert infra)
- Statement emails (`statements@axisbank.com`) are NOT fetched — they are PDF attachments, not transaction events.

### Lesson learned (recorded for RCA #7)
First version of the script searched only `alerts@axisbank.com` and silently missed every
transaction after Dec 22, 2025 because Axis switched their alert sender to `alerts@axis.bank.in`.
The user actually flagged this in the very first message ("sender email address will vary —
can be axis.in, axis.com, alerts @axis. something"). The fix: include BOTH senders in
`buildQuery()`. Always cast a wide net for sender domains on bank/utility alerts where the
sending infra is known to change over time.

## Key Decisions
| Decision | Rationale |
|----------|-----------|
| Use `format=full` from Gmail API | Returns full HTML body, unlike MCP connector's plaintext-only extraction |
| Loopback OAuth on `localhost:8080` | Required for desktop OAuth apps; OOB flow is deprecated |
| Store tokens in `~/.gmail-mcp/tokens.json` | Reuse across project sessions; keep out of repo |
| Node.js over Python | `npx` already available in env; `googleapis` is the official client |
| ESM modules (`type: module`) | Modern Node.js standard |
| PDF parsing server-side in API route | Keeps the binary off the wire after one hop and reuses the same `categorize()` + DB code path as Gmail rows |
| Synthetic `message_id` `pdf:<fileTag>:<rowHash>` for uploaded rows | Makes re-uploading a statement idempotent; collides on identical row text so accidental double-uploads merge instead of duplicating |
| Hardcoded source label `HDFC Credit Card` for uploaded rows | Only one issuer supported today; will be replaced with header-text detection when a second issuer lands |

## Known Issues / Open Items
- Dashboard date windows in `lib/db.js` are hard-coded to `2026-04-01`–`2026-05-31`.
  PDF statements covering earlier dates land in the DB but won't render in the
  UI lists / trends until the window is widened.
- PDF parser is tuned only to HDFC Diners Black layout. Axis CC / SBI / ICICI
  statements will not parse; the route will return "No transactions detected".
- City names are glued onto merchant strings in HDFC PDF rows (e.g.
  `BIRKENSTOCKGURUGRAM`). Keyword categorization still works via substring
  match, but the Expenses table shows the raw glued string.

## Future Improvements
- Add CSV/JSON export for all transactions
- Multi-issuer PDF detection (Axis CC, ICICI, SBI) keyed off header text
- Configurable / rolling dashboard date window instead of hard-coded months
- Generate spend summary by month
- Reconcile uploaded statement totals against Gmail-sourced rows for the same
  account / period (sanity check against double-counting)
