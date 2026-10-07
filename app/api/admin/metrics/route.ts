import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { clubMetrics, parseSessionsShown } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * The admin Metrics page's one read (docs/plans/usage-metrics.md). Totals and
 * rates only — `lib/metricsMath.ts` returns no names — so the cheap sync
 * `isAdminAuthed` is right for this read-only route.
 *
 * `?sessions=8|12|26` sets how many recent sessions the table covers;
 * anything else reads as 8.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin-metrics:${ip}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();

  const shown = parseSessionsShown(new URL(req.url).searchParams.get('sessions'));
  try {
    return NextResponse.json(await clubMetrics(resolveGroupId(req), shown));
  } catch (err) {
    console.error('[admin/metrics] read failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
