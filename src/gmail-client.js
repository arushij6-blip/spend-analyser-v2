/**
 * Thin wrapper around the Gmail API for reading messages.
 *
 * - Uses format='full' so we get the complete payload (including HTML body)
 * - Decodes base64url body parts (Gmail API encodes them)
 * - Walks nested multipart MIME trees to find the HTML and/or plaintext part
 */

import { google } from 'googleapis';

/**
 * List message IDs matching a Gmail search query.
 * Paginates internally — returns all matching IDs.
 *
 * @param {OAuth2Client} authClient
 * @param {string} query  - Gmail search query (same syntax as the UI search box)
 * @param {number} [maxResults=500] - hard cap to avoid runaway pulls
 * @returns {Promise<string[]>}
 */
export async function listMessageIds(authClient, query, maxResults = 500) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const ids = [];
  let pageToken;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: Math.min(500, maxResults - ids.length),
      pageToken,
    });
    const batch = res.data.messages ?? [];
    for (const m of batch) ids.push(m.id);
    pageToken = res.data.nextPageToken;
    if (ids.length >= maxResults) break;
  } while (pageToken);
  return ids;
}

/**
 * Fetch a single message in full format.
 *
 * @param {OAuth2Client} authClient
 * @param {string} messageId
 * @returns {Promise<gmail_v1.Schema$Message>}
 */
export async function getMessage(authClient, messageId) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return res.data;
}

/**
 * Extract a header value from a Gmail message payload (case-insensitive).
 */
export function getHeader(message, name) {
  const headers = message.payload?.headers ?? [];
  const target = name.toLowerCase();
  for (const h of headers) {
    if (h.name?.toLowerCase() === target) return h.value;
  }
  return undefined;
}

/**
 * Walk the MIME tree and return the first body part with the given mimeType.
 * Returns decoded UTF-8 string or null if not found.
 */
export function getBodyByMimeType(message, mimeType) {
  const payload = message.payload;
  if (!payload) return null;

  const visit = (part) => {
    if (part.mimeType === mimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const child of part.parts) {
        const found = visit(child);
        if (found != null) return found;
      }
    }
    return null;
  };
  return visit(payload);
}

/**
 * Returns the HTML body if present, else the plaintext body, else null.
 * Most useful for downstream parsers that can handle either.
 */
export function getBestBody(message) {
  return (
    getBodyByMimeType(message, 'text/html') ??
    getBodyByMimeType(message, 'text/plain') ??
    null
  );
}

/** Gmail API encodes body data as base64url. */
function decodeBase64Url(data) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}
