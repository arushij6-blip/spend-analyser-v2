import { NextResponse } from 'next/server';
import {
  getBudgetsForMonth,
  upsertBudget,
  deleteBudget,
  getCategorySpendForMonth,
} from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

function defaultMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevMonth(mo) {
  const [y, m] = mo.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * GET /api/budgets?month=YYYY-MM
 *
 * Returns a flat list combining the budget (if set) and the live net spend
 * for each category that has either a budget OR spend this month. Frontend
 * uses this to render the Budgets screen in one round-trip.
 *
 * Also returns `suggestions`: a map of category → last-month net spend, used
 * as the default value when the user opens the edit drawer on an unbudgeted
 * category. Empty for the very first month of usage.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get('month') ?? defaultMonth();

    const budgets = getBudgetsForMonth(month);
    const spendMap = getCategorySpendForMonth(month);
    const suggestionsMap = getCategorySpendForMonth(prevMonth(month));

    const budgetMap = new Map(budgets.map((b) => [b.category, b.amount]));
    const categories = new Set([...budgetMap.keys(), ...spendMap.keys()]);

    const rows = Array.from(categories).map((category) => {
      const budget = budgetMap.get(category) ?? null;
      const spent = spendMap.get(category) ?? 0;
      const pct = budget && budget > 0 ? (spent / budget) * 100 : null;
      return {
        category,
        budget,
        spent,
        remaining: budget != null ? budget - spent : null,
        pct,
      };
    });

    // Sort: budgeted rows first (by % desc), then unbudgeted by spend desc.
    rows.sort((a, b) => {
      const aHas = a.budget != null;
      const bHas = b.budget != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas) return (b.pct ?? 0) - (a.pct ?? 0);
      return b.spent - a.spent;
    });

    const suggestions = {};
    for (const [cat, amt] of suggestionsMap.entries()) {
      if (amt > 0) suggestions[cat] = amt;
    }

    return NextResponse.json({ month, rows, suggestions });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/budgets
 * Body: { category, month, amount }   // amount = null / 0 deletes
 */
export async function PUT(req) {
  try {
    const body = await req.json();
    const { category, month, amount } = body;
    if (!category || !month) {
      return NextResponse.json(
        { error: 'category and month are required' },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }
    const n = Number(amount);
    if (amount == null || !Number.isFinite(n) || n <= 0) {
      deleteBudget(category, month);
      return NextResponse.json({ ok: true, deleted: true });
    }
    upsertBudget(category, month, n);
    return NextResponse.json({ ok: true, category, month, amount: n });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
