import { NextResponse } from 'next/server';
import {
  getAllTransactions,
  getTopTransactionsForCategoryMonth,
  updateCategory,
  setTransactionHidden,
} from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const month = searchParams.get('month');
    if (category && month) {
      const limit = Math.min(50, Number(searchParams.get('limit') ?? 5));
      const rows = getTopTransactionsForCategoryMonth(category, month, limit);
      return NextResponse.json({ transactions: rows });
    }
    const rows = getAllTransactions();
    return NextResponse.json({ transactions: rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PATCH /api/transactions
 * Body: { messageId: string, category: string, learn?: boolean }
 *
 * Updates the category for one transaction. If `learn` is true, also stores a
 * merchant → category rule so future scans of this merchant pick up the new
 * category automatically.
 */
export async function PATCH(req) {
  try {
    const body = await req.json();
    const { messageId, category, learn = false, hidden } = body;
    if (!messageId) {
      return NextResponse.json(
        { error: 'messageId is required' },
        { status: 400 }
      );
    }
    if (typeof hidden === 'boolean') {
      const { changes } = setTransactionHidden(messageId, hidden);
      if (changes === 0) {
        return NextResponse.json(
          { error: `No transaction found with messageId=${messageId}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, hidden });
    }
    if (!category) {
      return NextResponse.json(
        { error: 'category is required' },
        { status: 400 }
      );
    }
    const { changes, alsoUpdatedIds } = updateCategory(messageId, category, { learn });
    if (changes === 0) {
      return NextResponse.json(
        { error: `No transaction found with messageId=${messageId}` },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, learned: learn, alsoUpdatedIds });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
