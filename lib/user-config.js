/**
 * User-config shim.
 *
 * Local dev: re-exports values from the gitignored `config.local.js`.
 * Vercel / any host without that file: reads the same values from env vars.
 *
 * Env var names (all JSON-encoded except DEFAULT_SOURCE):
 *   EMAIL_SOURCE_MAP_JSON       e.g. {"a@x.com":"Axis","b@x.com":"Joint Axis"}
 *   DEFAULT_SOURCE              e.g. "Axis"
 *   SELF_OWNED_ACCOUNTS_JSON    e.g. ["123456","789012"]
 *   STAFF_SALARY_PATTERNS_JSON  e.g. ["FIRST LAST","DRIVER NAME"]
 *
 * Falls back to safe defaults if neither source is set, so a barebones
 * deploy boots without crashing.
 */

let local = null;
try {
  local = await import('../config.local.js');
} catch {
  // config.local.js absent — Vercel deploys, fresh clones, etc.
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[user-config] failed to parse ${name} as JSON:`, err.message);
    return fallback;
  }
}

export const EMAIL_SOURCE_MAP =
  local?.EMAIL_SOURCE_MAP ?? parseJsonEnv('EMAIL_SOURCE_MAP_JSON', {});

export const DEFAULT_SOURCE =
  local?.DEFAULT_SOURCE ?? process.env.DEFAULT_SOURCE ?? 'Axis';

export const SELF_OWNED_ACCOUNTS =
  local?.SELF_OWNED_ACCOUNTS ??
  new Set(parseJsonEnv('SELF_OWNED_ACCOUNTS_JSON', []));

export const STAFF_SALARY_PATTERNS =
  local?.STAFF_SALARY_PATTERNS ??
  parseJsonEnv('STAFF_SALARY_PATTERNS_JSON', []);

export const EXAMPLE_EMAIL = local?.EXAMPLE_EMAIL ?? 'you@gmail.com';
