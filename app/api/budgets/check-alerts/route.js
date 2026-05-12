import { NextResponse } from 'next/server';
import { checkAndSendBudgetAlerts } from '../../../../lib/budget-alerts.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/budgets/check-alerts
 * Body: { month?: 'YYYY-MM' }
 *
 * Evaluates every budgeted category for the given month and sends a Telegram
 * alert when crossing 80% or 100% for the first time. Idempotent via the
 * `budget_alerts` table — calling twice never resends.
 *
 * Wired into the post-scan and post-upload flows so alerts arrive as soon as
 * fresh transactions land.
 */
export async function POST(req) {
  try {
    let body = {};
    try { body = await req.json(); } catch {}
    const result = await checkAndSendBudgetAlerts({ month: body.month });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
