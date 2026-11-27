import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { clubMetrics, parseSessionsShown } from '@/lib/metrics';

export const dynamic = 'force-dynamic';

/**
 * The admin Metrics page's one read (docs/plans/usage-metrics.md). Totals and
 * rates only — `lib/metricsMath.ts` returns no names — but `clubMetrics` also
 * attaches the string shelf and what the bench earned
 * (`lib/stringStockReport.ts`): what a set costs, what the shelf is worth and
 * the months' income. That is the club's money, so the admin is re-read on
 * every call (`isAdminAuthedWithMember`), as the stock route beside it; the
 * cookie alone kept answering a demoted or removed admin for its 30 days.
 *
 * `?sessions=8|12|26` sets how many recent sessions the table covers;
 * anything else reads as 8.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin-metrics:${ip}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  const shown = parseSessionsShown(new URL(req.url).searchParams.get('sessions'));
  try {
    return NextResponse.json(await clubMetrics(resolveGroupId(req), shown));
  } catch (err) {
    console.error('[admin/metrics] read failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
