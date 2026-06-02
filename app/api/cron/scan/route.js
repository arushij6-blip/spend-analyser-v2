import { NextResponse } from 'next/server';
import { runScan } from '../../../../lib/scan.js';
import { sendDailySummary } from '../../../../lib/daily-summary.js';

export const dynamic = 'force-dynamic';
// Scans can take 30–60s on a fresh run with hundreds of messages.
// Vercel Hobby plan allows up to 300s for cron-triggered functions.
export const maxDuration = 300;

/**
 * GET /api/cron/scan
 *
 * Daily scheduled scan. Vercel Cron invokes this once per day per the
 * schedule in vercel.json. The trigger is a plain HTTP GET, but with
 * `Authorization: Bearer ${CRON_SECRET}` set automatically by Vercel when
 * the env var is configured.
 *
 * If `CRON_SECRET` is set in env, requests without the matching bearer are
 * rejected. If unset, the endpoint is open — fine for dev/preview, but in
 * production you should set CRON_SECRET so no one else can trigger scans.
 */
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    // Same-day scan only: cron fires at 13:30 UTC = 19:00 IST every day.
    // Limiting the window to today keeps the Gmail fetch tiny and the run
    // well under the 300s function ceiling. Trade-off: if Vercel skips a
    // cron run (rare), that day's late emails sit unsynced until the next
    // run or a manual Sync click. Dedup via message_id makes that safe.
    const startDate = new Date().toISOString().slice(0, 10);
    console.log('[cron/scan] starting same-day scan from', startDate);
    const stats = await runScan(startDate);
    console.log('[cron/scan] done:', stats);

    // Post-scan: fire today's expense summary to Telegram.
    // Best-effort — never block the cron response on this.
    const summary = await sendDailySummary();
    console.log('[cron/scan] summary:', summary);

    return NextResponse.json({
      ok: true,
      triggeredBy: 'cron',
      startDate,
      summary,
      ...stats,
    });
  } catch (err) {
    console.error('[cron/scan] failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
