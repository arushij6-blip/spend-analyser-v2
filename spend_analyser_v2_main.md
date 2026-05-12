# Spend Analyser v2 — Project Knowledge File

## Purpose
A personal spend analyser that ingests transactions from multiple sources, categorizes them through a shared rules pipeline, persists them in SQLite, and visualizes spending in a Next.js dashboard.

Currently supported ingest sources:
1. **Gmail** — Axis Bank transaction-alert emails, fetched via the Gmail API
2. **PDF upload (HDFC)** — HDFC Diners Black credit-card statement PDFs, parsed server-side
3. **PDF upload (ICICI)** — ICICI Bank savings account statement PDFs, parsed server-side

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

ICICI savings-account spend was added next so the same dashboard can show
all spend irrespective of which bank an expense was routed through.

## Architecture

```
spend-analyser-v2/ (dir still named axis-email-reader)
├── package.json                       # name: spend-analyser-v2
├── .gitignore                         # Excludes node_modules, .env, tokens.json, data/app.db*
├── spend_analyser_v2_main.md          # This file - project knowledge
├── src/
│   ├── auth.js                        # OAuth 2.0 flow for Gmail (one-time, browser-based)
│   ├── gmail-client.js                # Gmail API wrapper for fetching messages
│   ├── transaction-parser.js          # Parses Axis email HTML → transaction fields
│   ├── pdf-statement-parser.js        # Parses HDFC Diners CC PDFs → transaction fields
│   ├── icici-pdf-statement-parser.js  # Parses ICICI savings account PDFs → transaction fields
│   ├── categorizer.js                 # Shared rules pipeline (refund / keywords / learned rules)
│   ├── fetch-all.js                   # CLI: scan all authenticated Gmail accounts
│   └── validate-one.js                # CLI: fetch ONE email, sanity-check parser output
├── app/
│   ├── page.jsx                       # Dashboard shell (TopBar with Sync + Upload, tabs)
│   ├── components/                    # Dashboard / Expenses / Review / Trends tabs
│   └── api/
│       ├── scan/route.js              # POST → run Gmail scan
│       ├── upload-pdf/route.js        # POST (multipart) → parse PDF, categorize, upsert
│       ├── transactions/              # GET list / PATCH category
│       └── trends/                    # GET monthly category totals
├── lib/
│   ├── db.js                          # SQLite layer (better-sqlite3, single source of truth)
│   └── scan.js                        # runScan() — used by /api/scan and future CLI
└── data/
    └── app.db                         # SQLite store (gitignored)
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

## PDF Statement Ingest

The dashboard's **Upload** button (next to Sync) accepts both HDFC and ICICI
statement PDFs. The file is POSTed multipart to `/api/upload-pdf`, which:

1. Tries `parseStatementPdf` (HDFC Diners Black format) first.
2. If zero rows are detected, falls back to `parseIciciStatementPdf`
   (ICICI savings account format).
3. Each parsed row goes through the same `categorize()` pipeline used for
   Gmail rows, so keyword rules, learned rules, and refund detection apply
   uniformly.
4. `upsertTransactions()` writes them — `message_id` is `pdf:<fileTag>:<rowHash>`
   so re-uploading the same PDF is idempotent and never produces duplicates.

Passwords are not supported. Locked uploads return a clear error from the route.

### HDFC Diners Black parser (`src/pdf-statement-parser.js`)
Statement rows look like:
```
DD/MM/YYYY| HH:MM  DESCRIPTION  [± rewardPts]  [+] C amount  l
```
- `+` before `C` ⇒ CREDIT, otherwise DEBIT
- Trailing ` l` marker closes a row (rows wrapping onto a second line are
  joined until the marker is seen)
- Card last-4 extracted from the masked card number in the page header
  (`00360886XXXX0525` → `XX0525`)

### ICICI savings parser (`src/icici-pdf-statement-parser.js`)
ICICI's statement layout is column-based:
```
S No. | Transaction Date | Transaction Remarks | Withdrawal | Deposit | Balance
```
After PDF text extraction the Withdrawal and Deposit columns collapse to the
same text position, so the parser can't tell which column the amount came
from on its own. It runs in two passes:

1. **Collection pass** — for each row, accumulate the wrapped merchant lines
   and pull out `(amount, balance)` from the trailing amounts line.
2. **Balance-diff pass** — walk the rows in order; compare each row's balance
   to the previous balance. If the balance increased by ~`amount` → CREDIT;
   if it decreased by ~`amount` → DEBIT. The first row falls back to DEBIT
   (rare; later rows correct it via the diff once the chain is established).

This balance-tracking approach matters because ICICI's text extraction
provides no other reliable signal: there is no `+` marker, no separate
column flag, and the same `1234.56 5678.90` pattern appears for both
withdrawals and deposits.

Account number is pulled from the statement header
(`Saving Account no. 008701530654`).

## Refund Detection (CREDIT-based)

The categorizer treats refunds as a first-class concept. Rather than matching
keywords like `REFUND`/`RETURN`, refund detection runs on the transaction
**type**:

> **Any CREDIT transaction is a refund**, unless it matches a known
> non-refund credit source (salary, investment settlement, FD maturity,
> dividend, internal transfer).

Non-refund CREDIT keywords (`NON_REFUND_CREDITS` in `categorizer.js`):
- Salary / income: `SALARY`, `PAYROLL`
- Investment settlements: `ZERODHA`, `ICCL`, `GROWW`, `UPSTOX`, `KUVERA`, `SMALLCASE`
- Deposits / maturity: `FD`, `TERM DEPOSIT`, `FIXED DEPOSIT`, `TD FROM`, `FD FROM`, `INTEREST`
- Other income: `DIVIDEND`, `BONUS`, `STOCK`, `MUTUAL FUND`
- Transfers in: `TRANSFER IN`, `CREDIT TRANSFER`, `NEFT IN`

When a transaction is flagged as a refund, the categorizer:
- Sets `out.isRefund = true`
- Routes it to `category = 'Shopping'`, `subCategory = 'Refund'`
- Returns immediately (refund detection wins over all keyword rules)

The DB stores this as `is_refund INTEGER` on the `transactions` table.
Monthly category totals are computed in two layers:

1. `getMonthlyCategoryTotals()` in `lib/db.js` returns `SUM(amount)` grouped
   by `(month, category, type)` — so DEBITs and CREDITs come back as
   separate rows, both as positive sums.
2. `TrendsTab.jsx` reduces those rows with `delta = type === 'DEBIT' ?
   total : -total`. CREDITs (which by construction in this categorizer are
   either refunds → Shopping/Refund, or non-refund credits that landed in
   the same category) subtract from the net.

So a Shopping month with ₹97,941.90 in debits and ₹63,129.51 in refunds
nets to ₹34,812.39.

`is_refund` is still useful for splitting `expense_count` vs `refund_count`
and for the Expenses tab's green `+` styling — it's just no longer used in
the net-total SQL itself.

The dashboard already paints CREDIT rows green with a leading `+`, so refund
rows display correctly without any UI change.

### Why CREDIT-based instead of keyword-based
The first implementation looked for `REFUND`/`RETURN`/`CHARGEBACK`/`REVERSAL`
substrings. That missed:
- PhonePe cashbacks (`UPI/PhonePe/phonepemerchan/R02 PhoneP/...`)
- Google Pay scratch-card credits (`UPI/Google Ind/gpayrefund-onl/...`
  matched, but generic Google credits didn't)
- P2P returns where someone sends money back without writing "refund"
  anywhere in the description

Switching to type-based detection caught all of these without needing an
ever-growing keyword list. The non-refund allowlist is much smaller and
more stable than the refund denylist would have been.

## Validation Approach
Per principle #5:
1. `validate-one.js` fetches the most recent Axis transaction email
2. Prints the raw HTML body (first 2000 chars) for inspection
3. Prints the parsed result as a JSON object
4. User confirms parsing is correct
5. THEN scale to all emails from 2025-05-01

For PDF uploads, validation happens by re-running parsing on a known
statement and confirming the row count plus a sample of net category
totals against the bank's own summary.

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

### Lesson learned (recorded for RCA #10)
April Shopping was rendering as ₹1,61,071 on the Trends tab when the true
net (debits ₹97,941.90 − refunds ₹63,129.51) was ₹34,812.39. Root cause:
refund subtraction was applied twice. The SQL in `getMonthlyCategoryTotals()`
returned `SUM(CASE WHEN is_refund = 1 THEN -amount ELSE amount END)` per
`(month, category, type)`, so the CREDIT row for refunds came back as a
negative number. Then `TrendsTab.jsx` ran `delta = type === 'DEBIT' ? total
: -total`, flipping the sign again. Two negations cancelled and refunds
ended up *added* to expenses instead of subtracted.

Fix: SQL now returns plain `SUM(amount)`. JSX retains the type flip,
which is the single, type-aware source of truth for sign — CREDIT refunds
(and any other CREDIT in the same category, which by design only happens
when something slipped past the non-refund allowlist) subtract correctly.

Lesson: when the same correction is encoded at two layers (SQL math AND
JSX reducer), they must be designed together — or one of them silently
double-applies. Pick one layer to own the sign; the other is a passthrough.

### Lesson learned (recorded for RCA #9)
Self-transfers and term-deposit credits were appearing on the Expenses tab as
`Shopping / Refund` (e.g. ₹3,87,521 "TD TO F", and multiple ₹50k–₹1L
`MOB/SELFFT/ANKUSH TAKYAR/...` rows). Root cause: the categorizer ran refund
detection (step 0) BEFORE the self-transfer / FD / investments / CC-bill
filters. Refund detection treats every CREDIT as a refund unless its merchant
or raw transaction info matches `NON_REFUND_CREDITS`. SELFFT and TD/FD
keywords were NOT in that allowlist, so the refund branch caught those
CREDITs first, tagged them `Shopping / Refund`, and returned — the
non-expense filters never ran. Because the ingest filter in `lib/scan.js`
only drops `Self Transfer` / `Investments` / `Credit Card Bill`, these rows
sailed into the DB as expenses and double-counted as negative spend in the
trends math.

Fix: re-ordered the categorizer pipeline so non-expense filters
(self-transfer, FD/TD, investments, CC bill, staff salary) run BEFORE
refund detection. Refund is now the fallback for *unmatched* CREDITs only.

**Ordering invariant going forward**: any new non-expense category MUST be
added BEFORE the refund check in `categorize()`. Equivalently: never add a
filter that runs only on the strength of `txn.type === 'CREDIT'` matching
above explicit category filters. If you find yourself extending
`NON_REFUND_CREDITS` to "fix" a mis-tag, ask whether the category really
belongs above the refund step instead.

### Lesson learned (recorded for RCA #8)
First ICICI parser pass classified every PDF row as DEBIT, including obvious
credits like PhonePe cashbacks and Google refunds. Root cause: the parser
assumed the leading amount on the amounts line was always a withdrawal,
because that's what the HDFC parser does. ICICI's two-column layout makes
that assumption wrong — the amount can be in either Withdrawal or Deposit,
and after PDF extraction both look identical. Fix: track balance changes
between consecutive rows and infer type from the sign of the diff. When the
underlying text strips structural cues, derive the missing signal from
something else in the document (here, the running balance).

## Database Schema

```sql
CREATE TABLE transactions (
  message_id            TEXT PRIMARY KEY,
  date                  TEXT,
  time                  TEXT,
  type                  TEXT NOT NULL,        -- 'DEBIT' or 'CREDIT'
  amount                REAL NOT NULL,
  currency              TEXT DEFAULT 'INR',
  account               TEXT,
  merchant              TEXT,
  category              TEXT NOT NULL,
  auto_category         TEXT NOT NULL,
  sub_category          TEXT,                 -- e.g. 'Refund', 'Term deposit'
  transaction_id        TEXT,
  bank_handle           TEXT,
  raw_transaction_info  TEXT,
  email_subject         TEXT,
  email_received_at     TEXT,
  source                TEXT NOT NULL,        -- 'Axis Bank' / 'HDFC Credit Card' / 'ICICI Bank' / ...
  is_refund             INTEGER NOT NULL DEFAULT 0,
  manually_edited       INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

`is_refund` is set by the categorizer (`recat.isRefund ? 1 : 0`) and persists
across re-categorization. It powers the net-spend math in
`getMonthlyCategoryTotals()` and the green `+` display on the Expenses tab.

For databases created before `is_refund` existed, the column is added via
`ALTER TABLE transactions ADD COLUMN is_refund INTEGER NOT NULL DEFAULT 0`.

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
| `/api/upload-pdf` tries HDFC parser, then ICICI on zero rows | No header-text detection needed; the parser that finds rows wins. Cheap to extend with a third parser. |
| ICICI parser uses balance-diff to determine CREDIT vs DEBIT | ICICI's text extraction collapses Withdrawal and Deposit columns; the running balance is the only reliable signal left |
| Refund detection by CREDIT type (not keyword match) | Keyword matching missed cashbacks and generic credits; the non-refund allowlist (salary/investments/transfers) is shorter and more stable than a refund denylist would be |
| Refunds routed to `Shopping` with `sub_category = 'Refund'` | Most refunds in this dataset are e-commerce returns; one bucket is simpler than splitting refunds across original-spend categories, and the green `+` makes them visually obvious in Expenses |
| Subtract refunds via JSX type-flip, not SQL CASE | Single layer of sign-flipping is correct; the original `SUM(CASE WHEN is_refund=1 THEN -amount ELSE amount END)` plus the JSX `type==='CREDIT' ? -total : total` double-negated refunds and *inflated* net spend. See RCA #10. |
| Hardcoded source label `HDFC Credit Card` / `ICICI Bank` for uploaded rows | Will be replaced with header-text detection if a fourth/fifth issuer lands |
| Drop `Credit Card Bill` rows at ingest (alongside `Self Transfer` and `Investments`) | Paying a CC bill — whether the savings-side debit to CRED Club or the BPPY/payment-received credit on the card statement — is settling debt, not new spend. The underlying purchases were already counted on the card statement, so writing the bill payment too would double-count. Filter is applied in both `lib/scan.js` and `app/api/upload-pdf/route.js`. The categorizer still tags these rows as `Credit Card Bill`; they just never reach the DB. To see them, relax the filter in those two write paths. |

## Known Issues / Open Items
- Dashboard date windows in `lib/db.js` are hard-coded to `2026-04-01`–`2026-05-31`.
  PDF statements covering earlier dates land in the DB but won't render in the
  UI lists / trends until the window is widened.
- ICICI parser's balance-diff logic relies on rows being processed in
  statement order. If a PDF is multi-page and rows aren't perfectly sequential
  (e.g. continuation rows split across pages), the first row of each page
  may misclassify until the next row's balance corrects the chain.
- Salary credits on ICICI savings (NEFT from employer) need to be filtered
  out at ingest like Self Transfer / Investments / CC Bill payments are.
  Currently they land in the DB and have to be deleted manually. A keyword
  rule on `SALARY` / employer name in the raw transaction info would handle
  this — same pattern as the existing non-expense filters.
- HDFC PDF parser is tuned only to Diners Black layout. Axis CC / SBI / other
  issuers will not parse; the upload route will return "No transactions
  detected" if neither HDFC nor ICICI parsers match.
- City names are glued onto merchant strings in HDFC PDF rows (e.g.
  `BIRKENSTOCKGURUGRAM`). Keyword categorization still works via substring
  match, but the Expenses table shows the raw glued string.
- ICICI merchant strings retain bank-handle fragments (`/ICI...`, `/YES BANK
  L/...`, `@hd`, `@ybl`) after cleanup. Categorization still works, but the
  Expenses table shows visually noisy merchant cells for ICICI rows.

## Future Improvements
- Add CSV/JSON export for all transactions
- Multi-issuer PDF detection (Axis CC, SBI, etc.) keyed off header text
- Configurable / rolling dashboard date window instead of hard-coded months
- Generate spend summary by month
- Reconcile uploaded statement totals against Gmail-sourced rows for the same
  account / period (sanity check against double-counting)
- Auto-filter salary credits at ingest, alongside Self Transfer / Investments
  / CC Bill
- Tighter ICICI merchant cleanup so the Expenses table is readable without
  hovering for the raw transaction info
