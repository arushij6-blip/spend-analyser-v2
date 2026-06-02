/**
 * OAuth 2.0 flow for Gmail API access — Multi-account support.
 *
 * - Loads client_id / client_secret from ~/.claude/.env.gmail (NOT committed)
 * - Spins up a local loopback HTTP server on localhost:8080 to capture the auth code
 * - Opens the user's browser to the Google consent screen
 * - Exchanges the code for access + refresh tokens
 * - Saves tokens to ~/.gmail-mcp/tokens.json as { "email@gmail.com": {...}, ... }
 *
 * Run once per account: `node src/auth.js <email>`
 * Or: `node src/auth.js` to authenticate the current browser session's account.
 */

import { google } from 'googleapis';
import http from 'node:http';
import { URL } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

const execAsync = promisify(exec);

// -------- Paths --------
const ENV_PATH = path.join(os.homedir(), '.claude', '.env.gmail');
const TOKENS_DIR = path.join(os.homedir(), '.gmail-mcp');
const TOKENS_PATH = path.join(TOKENS_DIR, 'tokens.json');

// -------- Constants --------
const REDIRECT_PORT = 8080;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * Load OAuth client credentials from ~/.claude/.env.gmail.
 * Throws if env file is missing or required vars are unset.
 */
async function loadCredentials() {
  const envResult = dotenv.config({ path: ENV_PATH });
  if (envResult.error) {
    throw new Error(
      `Failed to read credentials from ${ENV_PATH}. ` +
        `Ensure the file exists with GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.`
    );
  }
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      `GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET missing in ${ENV_PATH}.`
    );
  }
  return { clientId, clientSecret };
}

/**
 * Load all stored tokens from disk.
 * Returns { "email@gmail.com": { tokens }, ... } or {} if file doesn't exist.
 */
async function loadAllTokens() {
  try {
    const tokensRaw = await fs.readFile(TOKENS_PATH, 'utf-8');
    return JSON.parse(tokensRaw);
  } catch {
    return {};
  }
}

/**
 * Save all tokens to disk with 0600 permissions.
 */
async function saveAllTokens(allTokens) {
  await fs.mkdir(TOKENS_DIR, { recursive: true });
  await fs.writeFile(TOKENS_PATH, JSON.stringify(allTokens, null, 2), {
    mode: 0o600,
  });
  console.log(`  Tokens saved to ${TOKENS_PATH} (mode 0600).`);
}

/**
 * Returns an authenticated OAuth2 client for a specific email account.
 * - If tokens exist, reuses them (and refreshes if needed)
 * - If not, runs the browser flow to authenticate
 */
export async function getAuthClient(email) {
  const { clientId, clientSecret } = await loadCredentials();
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  // Try to load existing tokens for this email
  const allTokens = await loadAllTokens();
  if (allTokens[email]) {
    oauth2Client.setCredentials(allTokens[email]);
    try {
      await oauth2Client.getAccessToken();
      return oauth2Client;
    } catch {
      // Token refresh failed — re-authenticate
      console.log(`  Refresh token expired for ${email}. Re-authenticating…`);
    }
  }

  // No tokens or refresh failed — run interactive flow
  console.log(`\n  Authenticating ${email}…`);
  const tokens = await runBrowserFlow(oauth2Client);

  // Save new tokens alongside existing ones
  allTokens[email] = tokens;
  await saveAllTokens(allTokens);
  oauth2Client.setCredentials(tokens);
  return oauth2Client;
}

/**
 * Returns an array of { email, auth } objects for all authenticated accounts.
 *
 * On Vercel / any host without `~/.gmail-mcp/tokens.json` and `~/.claude/.env.gmail`,
 * reads OAuth credentials and refresh tokens from process.env instead:
 *   GMAIL_CLIENT_ID
 *   GMAIL_CLIENT_SECRET
 *   GMAIL_ACCOUNT_EMAILS                 comma-separated list of emails
 *   GMAIL_REFRESH_TOKEN_<EMAIL_SLUG>     one per email; <EMAIL_SLUG> is the
 *                                        email upper-cased with non-alnum→`_`
 *                                        e.g. you@gmail.com → YOU_GMAIL_COM
 */
export async function getAllAuthClients() {
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_ACCOUNT_EMAILS) {
    return getAllAuthClientsFromEnv();
  }
  const { clientId, clientSecret } = await loadCredentials();
  const allTokens = await loadAllTokens();

  const result = [];
  for (const [email, tokens] of Object.entries(allTokens)) {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );
    oauth2Client.setCredentials(tokens);
    result.push({ email, auth: oauth2Client });
  }
  return result;
}

function emailToEnvSlug(email) {
  return email.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Build auth clients exclusively from process.env. No filesystem access.
 * Designed for serverless deploys (Vercel, etc.) where the OAuth dance was
 * run locally and the refresh token was copied into env vars.
 */
function getAllAuthClientsFromEnv() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET not set. Set them in your Vercel env vars.'
    );
  }
  const emails = (process.env.GMAIL_ACCOUNT_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error(
      'GMAIL_ACCOUNT_EMAILS not set. Provide a comma-separated list of authenticated Gmail addresses.'
    );
  }

  const result = [];
  for (const email of emails) {
    const slug = emailToEnvSlug(email);
    const refreshToken = process.env[`GMAIL_REFRESH_TOKEN_${slug}`];
    if (!refreshToken) {
      console.warn(
        `[auth] missing GMAIL_REFRESH_TOKEN_${slug} — skipping ${email}`
      );
      continue;
    }
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    result.push({ email, auth: oauth2Client });
  }
  return result;
}

/**
 * Returns a list of all authenticated email accounts.
 */
export async function getAuthenticatedAccounts() {
  const allTokens = await loadAllTokens();
  return Object.keys(allTokens);
}

/**
 * Runs the interactive browser OAuth flow.
 * Returns the token bundle { access_token, refresh_token, ... }.
 */
async function runBrowserFlow(oauth2Client) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // get a refresh_token
    prompt: 'consent', // force refresh_token on every run
    scope: SCOPES,
  });

  console.log('  Opening your browser for Google sign-in…');
  console.log('  If it does not open automatically, visit:\n');
  console.log(`  ${authUrl}\n`);

  // Start local callback server
  const codePromise = startCallbackServer();

  // Open the browser (macOS uses `open`, Linux uses `xdg-open`)
  const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    await execAsync(`${openCmd} "${authUrl}"`);
  } catch {
    // user can paste the URL manually
  }

  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Starts a one-shot HTTP server that captures the OAuth callback code
 * and shuts itself down after the first valid request.
 */
function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
        if (reqUrl.pathname !== '/callback') {
          res.writeHead(404).end('Not found');
          return;
        }
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' }).end(
            `<h1>Authorization failed</h1><p>${error}</p>`
          );
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }
        if (!code) {
          res.writeHead(400).end('Missing code parameter');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(
          `<h1>You're all set ✔</h1><p>You can close this tab and return to the terminal.</p>`
        );
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(500).end('Server error');
        reject(err);
      }
    });
    server.listen(REDIRECT_PORT, () => {
      // ready
    });
    server.on('error', reject);
  });
}

// -------- CLI entrypoint --------
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const email = process.argv[2];
  if (!email) {
    console.log('Usage: node src/auth.js <email@gmail.com>');
    console.log('Example: node src/auth.js you@gmail.com');
    process.exit(1);
  }

  getAuthClient(email)
    .then(() => {
      console.log(`\n✓ Authenticated ${email}. You can now run scans.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n✗ Auth failed:', err.message);
      process.exit(1);
    });
}
