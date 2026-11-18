/**
 * What the bench earned (docs/plans/stringing-earnings.md). Admin read only:
 * a stringer who is not an admin sees no money anywhere (`toStringerJob`).
 *
 * The shelf comes through `loadStringStock`, the one stock loader, so a job's
 * string cost is the line the stock count matched it to (`jobLines`); the
 * jobs' money fields come from a projection of their own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { loadStringStock } from '@/lib/stringStocktake';
import { EARNINGS_JOB_SELECT, summarizeEarnings, type EarningsJob } from '@/lib/stringingEarnings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`stringing-earnings-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isAdminAuthed(req)) return unauthorized();
  let step = 'start';
  const at = <T,>(name: string, p: Promise<T>): Promise<T> => p.catch((err) => { step = name; throw err; });
  try {
    const groupId = resolveGroupId(req);
    const now = new Date();
    const [stock, jobs] = await Promise.all([
      loadStringStock(groupId, { now, at }).catch((err) => {
        if ((err as { step?: string }).step) step = (err as { step: string }).step;
        throw err;
      }),
      at('earnings-jobs', groupScope(groupId).query<EarningsJob>('stringingJobs', { select: EARNINGS_JOB_SELECT })),
    ]);
    return NextResponse.json({ ...summarizeEarnings({ jobs, stock: stock.summary, now }), now: now.toISOString() });
  } catch (err) {
    console.error('GET /api/stringing/earnings failed', { step }, err);
    return NextResponse.json({ error: 'read_failed', step }, { status: 503 });
  }
}
