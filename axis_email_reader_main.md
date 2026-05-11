# Axis Email Reader - Project Knowledge File

## Purpose
Read Axis Bank transaction emails from Gmail via the Gmail API directly, extract transaction details (date, time, amount, merchant name), and export structured data.

## Why This Project Exists
The claude.ai Gmail MCP connector only returns plaintext body content from emails. Axis Bank transaction alerts are HTML-only emails (no plaintext alternative MIME part), so the connector returns only truncated snippets — the merchant name is cut off.

This project calls the Gmail API directly with `format=full` to retrieve the HTML body of every transaction email and parses the full "Transaction Info" line.

## Architecture

```
axis-email-reader/
├── package.json              # Node.js project metadata, dependencies
├── .gitignore                # Excludes node_modules, .env, tokens.json
├── axis_email_reader_main.md # This file - project knowledge
├── src/
│   ├── auth.js               # OAuth 2.0 flow (one-time, browser-based)
│   ├── gmail-client.js       # Wrapper around Gmail API for fetching messages
│   ├── transaction-parser.js # Parses HTML body to extract transaction fields
│   └── validate-one.js       # Fetches ONE email, validates parser, prints result
└── data/
    └── (transaction CSV/JSON output goes here once we scale)
```

## Tech Stack
- **Node.js (ESM)** — Runtime
- **googleapis** — Google's official Node.js client for Gmail API
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

## Known Issues / Open Items
- (none yet — will document as encountered)

## Future Improvements
- Add CSV/JSON export for all transactions
- De-duplicate transactions (same txn appearing in multiple emails)
- Categorize merchants (food, transport, utilities, etc.)
- Generate spend summary by month
