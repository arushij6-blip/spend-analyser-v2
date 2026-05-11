/**
 * Validation script: fetches ONE Axis Bank alert email, prints both the raw
 * HTML body (excerpt around transaction info) and the parsed result.
 *
 * Per project principle #5 (Validate on a small sample before scaling),
 * we DO NOT loop over many emails here. Run this once, eyeball the output,
 * and only proceed to fetch-all.js once parsing looks correct.
 *
 * Usage:
 *   node src/validate-one.js                    # most recent debit alert
 *   node src/validate-one.js <messageId>        # specific message
 *   node src/validate-one.js --p2m              # most recent UPI/P2M (merchant)
 *   node src/validate-one.js --p2a              # most recent UPI/P2A (person)
 *   node src/validate-one.js --self             # most recent self-transfer
 */

import { getAuthClient } from './auth.js';
import {
  listMessageIds,
  getMessage,
  getHeader,
  getBodyByMimeType,
} from './gmail-client.js';
import { parseAxisTransactionEmail, htmlToText } from './transaction-parser.js';

const ARG = process.argv[2];

function buildQuery() {
  // Default: most recent alert email (any type)
  const base = 'from:alerts@axisbank.com (debited OR credited)';
  return base;
}

async function pickMessageId(auth) {
  // Allow passing a specific message ID
  if (ARG && !ARG.startsWith('--')) return ARG;

  // Otherwise list recent alert emails and pick one matching the flag
  const ids = await listMessageIds(auth, buildQuery(), 25);
  if (ids.length === 0) {
    throw new Error('No matching emails found.');
  }
  if (!ARG) return ids[0];

  // Scan a few to find one with the right transaction shape
  for (const id of ids) {
    const m = await getMessage(auth, id);
    const subject = getHeader(m, 'Subject') ?? '';
    const html = getBodyByMimeType(m, 'text/html') ?? '';
    const text = htmlToText(html);
    if (ARG === '--p2m' && /UPI\/P2M\//i.test(text)) return id;
    if (ARG === '--p2a' && /UPI\/P2A\//i.test(text)) return id;
    if (ARG === '--self' && /MOB\/SELFFT/i.test(text)) return id;
  }
  throw new Error(`No email matching ${ARG} in the last ${ids.length} alerts.`);
}

async function main() {
  console.log('→ Authenticating…');
  const auth = await getAuthClient();

  console.log('→ Picking message…');
  const messageId = await pickMessageId(auth);

  console.log(`→ Fetching message ${messageId} (format=full)…\n`);
  const message = await getMessage(auth, messageId);

  const subject = getHeader(message, 'Subject');
  const from = getHeader(message, 'From');
  const date = getHeader(message, 'Date');
  const html = getBodyByMimeType(message, 'text/html');
  const plaintext = getBodyByMimeType(message, 'text/plain');

  console.log('───── Email headers ─────');
  console.log(`Message ID: ${messageId}`);
  console.log(`From:       ${from}`);
  console.log(`Subject:    ${subject}`);
  console.log(`Date:       ${date}`);
  console.log(
    `HTML body present:      ${html ? 'yes (' + html.length + ' chars)' : 'no'}`
  );
  console.log(
    `Plaintext body present: ${plaintext ? 'yes (' + plaintext.length + ' chars)' : 'no'}`
  );

  // Show the decoded text around "Transaction Info" so we can see exactly
  // what the parser is working with.
  const text = htmlToText(html ?? '');
  console.log('\n───── Decoded text (full) ─────');
  console.log(text);

  console.log('\n───── Parsed result ─────');
  const parsed = parseAxisTransactionEmail({
    html,
    plaintext,
    subject,
    date,
  });
  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((err) => {
  console.error('\n✗ Failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
