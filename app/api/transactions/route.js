import { NextResponse } from 'next/server';
import { getAllTransactions, updateCategory } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
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
    const { messageId, category, learn = false } = body;
    if (!messageId || !category) {
      return NextResponse.json(
        { error: 'messageId and category are required' },
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
