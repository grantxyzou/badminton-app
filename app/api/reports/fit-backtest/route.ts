/**
 * GET /api/reports/fit-backtest — the owned-racket backtest of the fit engine
 * (`lib/fitBacktest.ts`; docs/plans/racket-fit-engine.md), as totals.
 *
 * Authed by `x-reports-key` like `reports/metrics`: a read-only per-club
 * secret, so the gate the plan reads can be run by a script or by the
 * operator without a browser session, and repeated after every engine
 * change. Rate limit first (security rule 4); a missing, wrong or rotated key
 * is one 401. Nothing per person leaves this route.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupForReportsKey } from '@/lib/reportsAccess';
import { runFitBacktest } from '@/lib/fitBacktest';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`reports-fit-backtest:${getClientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = await groupForReportsKey(req.headers.get('x-reports-key'));
  if (!groupId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runFitBacktest(groupId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[reports/fit-backtest] read failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
