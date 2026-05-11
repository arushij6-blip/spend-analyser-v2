/**
 * Local config template.
 *
 * Copy this file to `config.local.js` and fill in your own values.
 * `config.local.js` is gitignored — never commit personal data.
 */

// Map each authenticated Gmail address to a human-readable "source" label
// shown in the UI. Any account not listed here falls back to DEFAULT_SOURCE.
export const EMAIL_SOURCE_MAP = {
  // 'your-other-account@gmail.com': 'Joint Axis',
};

export const DEFAULT_SOURCE = 'Axis';

// Account numbers you own. MOB-TD transfers to these accounts are treated
// as self-transfers (and excluded from expenses), not as outgoing spend.
export const SELF_OWNED_ACCOUNTS = new Set([
  // '123456789012345',
]);

// UPPERCASE merchant-name substrings that should be categorized as
// "Staff Salaries" (household help, drivers, etc.).
export const STAFF_SALARY_PATTERNS = [
  // 'FIRST LAST',
];

// Example email shown in CLI usage strings.
export const EXAMPLE_EMAIL = 'you@gmail.com';
