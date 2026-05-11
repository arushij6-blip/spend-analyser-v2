// Categories available in the dropdown. Keep in sync with src/categorizer.js KNOWN_CATEGORIES.
export const CATEGORIES = [
  'Groceries',
  'Shopping',
  'Daily Commute',
  'Travel',
  'Home Maintenance',
  'Staff Salaries',
  'Medical',
  'Going Out',
  'Ordering In',
  'Credit Card Bill',
  'Misc',
];

export function fmtAmount(n) {
  return (
    '₹' +
    Number(Math.round(n)).toLocaleString('en-IN')
  );
}

export function fmtDate(s) {
  if (!s) return '—';
  // s = 'YYYY-MM-DD'
  const [y, m, d] = s.split('-');
  if (!y) return s;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${monthNames[Number(m) - 1]} ${y}`;
}
