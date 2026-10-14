/**
 * GET /api/reports/feedback — "Report a problem" messages for the monthly UX
 * report (docs/plans/usage-metrics.md), with the person taken out.
 *
 * A report is a `kind: 'feedback'` row in the GLOBAL `releases` container
 * (lib/feedback.ts): it goes to whoever runs the deployment, not to a club's
 * admin (lib/containers.ts). So only the
 * OPERATOR'S club key may read it — BPM's, the club this deployment is run
 * for — and every other club's key gets 403.
 *
 * Each row keeps the message, the tab and the PATH it was sent from, and when.
 * Dropped: the IP (rate-limiting data, never for reading), the name (a report
 * is about the app, not the person), and the URL's query and fragment, which
 * can carry an invite token or a one-time code.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupForReportsKey, pathOnly, type FeedbackReportRow } from '@/lib/reportsAccess';
import { readFeedbackSince } from '@/lib/feedback';
import { BPM_GROUP_ID } from '@/lib/groupScope';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 200;
const DEFAULT_DAYS = 31;
const MAX_DAYS = 90;

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`reports-feedback:${getClientIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const groupId = await groupForReportsKey(req.headers.get('x-reports-key'));
  if (!groupId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (groupId !== BPM_GROUP_ID) return NextResponse.json({ error: 'operator_only' }, { status: 403 });

  const rawDays = Number(new URL(req.url).searchParams.get('days'));
  const days = Number.isInteger(rawDays) && rawDays >= 1 ? Math.min(rawDays, MAX_DAYS) : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const rows: FeedbackReportRow[] = (await readFeedbackSince(since))
      .slice(0, MAX_ROWS)
      .map((r) => ({
        createdAt: r.createdAt as string,
        message: r.message as string,
        tab: typeof r.tab === 'string' ? r.tab : null,
        path: pathOnly(r.url),
      }));
    return NextResponse.json({ days, rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[reports/feedback] read failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
