/**
 * Transaction categorizer for Axis Bank transactions.
 *
 * Pipeline (highest priority first):
 *   1. SELF-TRANSFER       → filtered out by fetch-all (not an expense)
 *   2. FD/TD movements     → "Self Transfer" (own-money, filtered out)
 *   3. Investments keywords → "Investments" (filtered out by fetch-all)
 *   4. Credit Card Bill keywords → "Credit Card Bill" (filtered out)
 *   5. Staff Salary names  → explicit merchant matches → "Staff Salaries"
 *   6. Refund detection    → CREDIT not in non-refund allowlist → Shopping/Refund
 *   7. LEARNED RULES       → user-confirmed merchant → category overrides
 *   8. Daily Commute rule  → amount ≤ 150 AND time in commute windows (DEBIT only)
 *   9. Ordering In rule    → Zomato / Swiggy → "Ordering In"
 *  10. Merchant keyword rules → see MERCHANT_RULES below
 *  11. Shape-based fallback → UPI-P2A → "Misc"; rest → "Misc"
 *
 * IMPORTANT ordering invariant: non-expense filters (steps 1–5) MUST run
 * BEFORE refund detection (step 6). A CREDIT can be a self-transfer, a TD
 * maturity, an investment settlement, or a CC bill payment — none of those
 * are refunds. See RCA #9.
 *
 * Categories (11 total):
 *   Groceries, Shopping, Daily Commute, Travel, Home Maintenance,
 *   Staff Salaries, Medical, Going Out, Ordering In, Credit Card Bill, Misc
 */

import { STAFF_SALARY_PATTERNS } from '../lib/user-config.js';

// -------- Commute rule --------
const COMMUTE_AMOUNT_THRESHOLD = 150;
const COMMUTE_WINDOWS = [
  { start: '08:30:00', end: '10:00:00' },
  { start: '17:30:00', end: '19:00:00' },
];

function isInCommuteWindow(timeStr) {
  if (!timeStr) return false;
  return COMMUTE_WINDOWS.some((w) => timeStr >= w.start && timeStr <= w.end);
}

// -------- Staff salary merchants --------
// UPPERCASE merchant-name substrings. Configured in config.local.js.

// -------- "Ordering In" exact set --------
const ORDERING_IN_KEYWORDS = [
  'ZOMATO',
  'ETERNAL LIMITED',   // Zomato's renamed parent entity
  'ETERNAL LTD',
  'SWIGGY',
];

// -------- Term/fixed deposit movements (filtered out as non-expenses) --------
// Match raw_transaction_info patterns like "TD TO F", "TD FROM", "FD MAT",
// "TERM DEPOSIT", "FIXED DEPOSIT" — Axis credits/debits between savings and
// a customer's own deposit.
const FD_TRANSFER_KEYWORDS = [
  'MBB-TD',
  'TD TO',
  'TD FROM',
  'FD TO',
  'FD FROM',
  'TERM DEPOSIT',
  'FIXED DEPOSIT',
];

// -------- Investment platforms (filtered out as non-expenses) --------
const INVESTMENT_KEYWORDS = [
  'ZERODHA',
  'ICCL ZERODHA',       // Indian Clearing Corp — Zerodha settlement
  'ICCL',                // Indian Clearing Corporation Ltd (broker settlement)
  'GROWW',
  'UPSTOX',
  'KUVERA',
  'COIN BY ZERODHA',
  'SMALLCASE',
  'INDIAN CLEARING',
];

// -------- Credit Card Bill payments --------
const CREDIT_CARD_BILL_KEYWORDS = [
  'CRED CLUB',
  'CREDITCARD BILL',
  'CC PAYMENT',
];

// -------- Non-refund CREDIT keywords (salary, income, investments, internal transfers) --------
const NON_REFUND_CREDITS = [
  'SALARY', 'PAYROLL', 'SALARY IN', 'SALARY CR',
  'ZERODHA', 'ICCL', 'GROWW', 'UPSTOX', 'KUVERA', 'COIN BY ZERODHA', 'SMALLCASE',
  'FD', 'TERM DEPOSIT', 'FIXED DEPOSIT', 'TD FROM', 'FD FROM', 'INTEREST',
  'DIVIDEND', 'BONUS', 'STOCK', 'MUTUAL FUND',
  'TRANSFER IN', 'CREDIT TRANSFER', 'NEFT IN',
];

// -------- Merchant keyword rules --------
// Order matters: more specific patterns first.
const MERCHANT_RULES = [
  // Groceries / Quick commerce
  {
    category: 'Groceries',
    keywords: [
      'ZEPTO', 'BLINKIT', 'BLINK COMMERCE', 'GROFERS',
      'BIG BASKET', 'BIGBASKET', 'INSTAMART', 'JIOMART',
      'DMART', 'D MART', 'RELIANCE SMART', 'RELIANCE FRESH',
      'MORE RETAIL', 'NATURES BASKET', 'SPENCER',
    ],
  },

  // Going Out (restaurants, cafes, bakeries — NOT delivery apps)
  {
    category: 'Going Out',
    keywords: [
      'DOMINOS', 'PIZZA HUT', 'MCDONALD', 'KFC', 'BURGER KING',
      'SUBWAY', 'STARBUCKS', 'DUNKIN', 'CHAI POINT', 'BARISTA',
      'BIRYANI', 'BAKERY', 'BAKE HOUSE', 'RESTAURANT', 'KITCHEN',
      'CAFE', 'COFFEE', 'EATERY', 'FOODS', 'NAZEER', 'HALDIRAM',
      'BIKANER', 'WOW MOMO', 'BISTRO', 'GOURMET BAZAAR', 'DOHFUL',
      'BOBA BHAI', 'GHL', 'PAX INNOVATION', 'HORIZON ONE',
    ],
  },

  // Shopping / E-commerce
  {
    category: 'Shopping',
    keywords: [
      'AMAZON', 'FLIPKART', 'MYNTRA', 'WWW MYNTR', 'AJIO', 'NYKAA',
      'MEESHO', 'SNAPDEAL', 'TATA CLIQ', 'TATACLIQ', 'FIRSTCRY',
      'LENSKART', 'DECATHLON', 'H AND M', 'HM HENNES', 'HENNES MAURITZ',
      'ZARA', 'ZUDIO', 'WESTSIDE', 'PANTALOON', 'SHOPPERS STOP',
      'CROMA', 'DIGITAL AGE RETAIL', 'RELIANCE DIGITAL', 'VIJAY SALES',
      'IKEA', 'PEPPERFRY', 'URBAN LADDER', 'FABINDIA', 'BIBA',
      'W FOR WOMEN', 'GLOBAL DESI', 'UNIQLO', 'JOCKEY',
      'CROSSWORD BOOKSTORE', 'NESTASIA', 'PUREHOMEANDLIVING',
      'MODERN QUESTS', 'NURSERY',
    ],
  },

  // Daily Commute — ride-hailing, public transit, fuel
  {
    category: 'Daily Commute',
    keywords: [
      'UBER', 'OLA', 'RAPIDO', 'NAMMA YATRI', 'BLU SMART', 'BLUSMART',
      'METRO', 'DMRC',
      // Fuel (remapped here)
      'INDIAN OIL', 'INDIANOIL', 'HPCL', 'BPCL', 'HP PETROL',
      'BHARAT PETROLEUM', 'NAYARA', 'PETROL PUMP', 'FUEL STATION',
      'SHELL', 'MASTER FUELS',
    ],
  },

  // Travel — flights, hotels, rail, buses
  {
    category: 'Travel',
    keywords: [
      'MAKEMYTRIP', 'MAKE MY TRIP', 'GOIBIBO', 'EASEMYTRIP',
      'EASE MY TRIP', 'CLEARTRIP', 'YATRA', 'REDBUS', 'RED BUS',
      'ABHIBUS', 'OYO', 'AIRBNB', 'BOOKING', 'AGODA', 'INDIGO',
      'VISTARA', 'AIR INDIA', 'SPICEJET', 'AKASA', 'PASSPORT SEVA',
      'AMBIENCE HOTEL', 'HOTEL', 'IRCTC', 'IRCT', 'INDIAN RAILWAY',
    ],
  },

  // Medical / Healthcare / Pharmacy / Fitness
  {
    category: 'Medical',
    keywords: [
      'PHARMEASY', 'PHARM EASY', '1MG', 'TATA 1MG', 'NETMEDS',
      'APOLLO PHARMACY', 'APOLLO HOSP', 'FORTIS', 'MEDPLUS',
      'MED PLUS', 'MANIPAL', 'MAX HEALTH', 'AIIMS', 'PRACTO',
      'CULT FIT', 'CULTFIT', 'CURE FIT', 'CUREFIT', 'HEALTHIFY',
      'CLINIC', 'HOSPITAL', 'PHARMACY', 'DIAGNOSTIC', 'PATH LAB',
      'PATHLAB', 'THYROCARE', 'CLOUDNINE', 'MOTHERHOOD', 'MOTHER HOOD',
    ],
  },

  // Home Maintenance — services + utilities + mobile/internet + rent
  {
    category: 'Home Maintenance',
    keywords: [
      'URBAN COMPANY', 'URBANCOMPANY',
      // Utilities (remapped)
      'TATA POWER', 'ADANI ELECTRICITY', 'BSES', 'MSEDCL', 'BESCOM',
      'TORRENT POWER', 'ELECTRICITY', 'WATER BILL', 'GAS BILL',
      'INDIANE', 'INDANE', 'HP GAS', 'BHARAT GAS', 'IGL', 'MGL',
      'BROADBAND', 'ACT FIBERNET', 'SPECTRA', 'HATHWAY', 'TIKONA',
      // Mobile & Internet (remapped)
      'JIO', 'AIRTEL', 'VI ', 'VODAFONE', 'BSNL', 'MTNL', 'RECHARGE',
      // Rent & Housing (remapped)
      'RENT', 'NOBROKER', 'NO BROKER', 'NESTAWAY', 'MAINTENANCE',
      'MY GATE', 'MYGATE', 'GODREJNORTHZONE',
    ],
  },
];

/**
 * Categorize a parsed transaction.
 *
 * @param {object} txn - parsed transaction
 * @param {Map<string,string>} [learnedRules] - optional map of UPPERCASE merchant
 *        substring → category, applied BEFORE built-in keyword rules.
 */
export function categorize(txn, learnedRules) {
  const out = { ...txn };

  const merchant = (txn.merchant ?? '').toUpperCase();
  const rawInfo = (txn.rawTransactionInfo ?? '').toUpperCase();

  out.isRefund = false;

  // 1) Self-transfer (parser-tagged via MOB/SELFFT) — not an expense
  if (txn.category === 'SELF-TRANSFER') {
    out.category = 'Self Transfer';
    out.subCategory = null;
    return out;
  }

  // 2) Term/fixed deposit movements — own-money transfers, not expenses
  if (merchant || rawInfo) {
    for (const kw of FD_TRANSFER_KEYWORDS) {
      if (merchant.includes(kw) || rawInfo.includes(kw)) {
        out.category = 'Self Transfer';
        out.subCategory = 'Term deposit';
        return out;
      }
    }
  }

  // 3) Investments (parser-tagged or keyword)
  if (txn.category === 'Investments') {
    out.category = 'Investments';
    out.subCategory = null;
    return out;
  }
  if (merchant || rawInfo) {
    for (const kw of INVESTMENT_KEYWORDS) {
      if (merchant.includes(kw) || rawInfo.includes(kw)) {
        out.category = 'Investments';
        out.subCategory = null;
        return out;
      }
    }
  }

  // 4) Credit Card Bill payments (CRED Club etc.)
  if (merchant || rawInfo) {
    for (const kw of CREDIT_CARD_BILL_KEYWORDS) {
      if (merchant.includes(kw) || rawInfo.includes(kw)) {
        out.category = 'Credit Card Bill';
        out.subCategory = null;
        return out;
      }
    }
  }

  // 5) Staff salary explicit matches
  if (merchant) {
    for (const pattern of STAFF_SALARY_PATTERNS) {
      if (merchant.includes(pattern)) {
        out.category = 'Staff Salaries';
        out.subCategory = 'Staff payment';
        return out;
      }
    }
  }

  // 6) Refund detection — MUST run AFTER non-expense filters above.
  // A CREDIT can be a self-transfer / TD maturity / investment settlement /
  // CC bill payment — none of those are refunds. See RCA #9.
  if (txn.type === 'CREDIT') {
    let isNonRefundCredit = false;
    for (const kw of NON_REFUND_CREDITS) {
      if (merchant.includes(kw) || rawInfo.includes(kw)) {
        isNonRefundCredit = true;
        break;
      }
    }
    if (!isNonRefundCredit) {
      out.isRefund = true;
      out.category = 'Shopping';
      out.subCategory = 'Refund';
      return out;
    }
  }

  // 3) Learned rules (user-confirmed overrides)
  if (learnedRules && merchant) {
    for (const [pattern, category] of learnedRules) {
      if (merchant.includes(pattern)) {
        out.category = category;
        out.subCategory = 'Learned rule';
        return out;
      }
    }
  }

  // 4) Daily Commute rule — debits only, small amount, in commute window
  if (
    txn.type === 'DEBIT' &&
    typeof txn.amount === 'number' &&
    txn.amount <= COMMUTE_AMOUNT_THRESHOLD &&
    isInCommuteWindow(txn.time)
  ) {
    out.category = 'Daily Commute';
    out.subCategory = 'Auto-rule (≤₹150 in commute window)';
    return out;
  }

  // 5) Ordering In takes precedence over generic merchant rules
  if (merchant && ORDERING_IN_KEYWORDS.some((kw) => merchant.includes(kw))) {
    out.category = 'Ordering In';
    out.subCategory = null;
    return out;
  }

  // 6) Merchant keyword rules
  if (merchant) {
    for (const rule of MERCHANT_RULES) {
      if (rule.keywords.some((kw) => merchant.includes(kw))) {
        out.category = rule.category;
        out.subCategory = null;
        return out;
      }
    }
  }

  // 7) Shape-based fallback for UPI-P2A / IMPS-P2A
  if (txn.category === 'UPI-P2A' || txn.category === 'IMPS-P2A') {
    out.category = txn.type === 'CREDIT' ? 'Misc' : 'Misc';
    out.subCategory = null;
    return out;
  }

  // 8) Fallback → Misc for everything
  out.category = 'Misc';
  out.subCategory = null;
  return out;
}

// Convenience re-export for callers that want to know the available categories.
export const KNOWN_CATEGORIES = [
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
