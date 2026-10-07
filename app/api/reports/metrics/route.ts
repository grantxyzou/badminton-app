/**
 * GET /api/reports/metrics — the weekly report's one read
 * (docs/plans/usage-metrics.md). The same `clubMetrics()` the admin Metrics
 * page reads, so the report and the page cannot disagree. Totals only: the
 * module returns no names.
 *
 * Authed by `x-reports-key` — a scheduled helper has no cookie — which names
 * its club. Rate limit first (security rule 4); a missing, wrong or rotated
 * key is one 401.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupForReportsKey } from '@/lib/reportsAccess';
import { clubMetrics, parseSessionsShown } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`reports-metrics:${getClientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = await groupForReportsKey(req.headers.get('x-reports-key'));
  if (!groupId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const shown = parseSessionsShown(new URL(req.url).searchParams.get('sessions'));
    return NextResponse.json(await clubMetrics(groupId, shown), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[reports/metrics] read failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
