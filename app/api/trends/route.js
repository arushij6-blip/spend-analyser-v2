import { NextResponse } from 'next/server';
import { getMonthlyCategoryTotals } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await getMonthlyCategoryTotals();
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
