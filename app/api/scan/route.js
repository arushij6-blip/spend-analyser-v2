import { NextResponse } from 'next/server';
import { runScan } from '../../../lib/scan.js';

export const dynamic = 'force-dynamic';
// Scans can take 30–60s on a fresh run with hundreds of messages.
export const maxDuration = 300;

/**
 * POST /api/scan
 * Body: { startDate?: string }   // YYYY-MM-DD, default 2025-05-01
 *
 * Triggers a Gmail scan, parses & categorizes new transactions, and writes
 * them to the SQLite store (preserves user-edited categories on conflict).
 */
export async function POST(req) {
  try {
    let body = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }
    const startDate = body.startDate ?? '2025-05-01';
    const stats = await runScan(startDate);
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
