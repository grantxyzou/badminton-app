/**
 * What the bench earned (docs/plans/stringing-earnings.md). Admin read only,
 * re-checked on every call:
 * a stringer who is not an admin sees no money anywhere (`toStringerJob`).
 *
 * The read itself is `loadStringEarnings`, shared with the club report.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { loadStringEarnings } from '@/lib/stringingEarningsRead';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`stringing-earnings-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // A FRESH check: this read is the club's money, and the cookie alone keeps
  // answering a demoted or removed admin for its 30 days (security rule
  // "Fresh admin check wherever a read names money", as the stock route).
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  let step = 'start';
  const at = <T,>(name: string, p: Promise<T>): Promise<T> => p.catch((err) => { step = name; throw err; });
  try {
    const groupId = resolveGroupId(req);
    const now = new Date();
    const { earnings } = await loadStringEarnings(groupId, { now, at }).catch((err) => {
      if ((err as { step?: string }).step) step = (err as { step: string }).step;
      throw err;
    });
    return NextResponse.json({ ...earnings, now: now.toISOString() });
  } catch (err) {
    console.error('GET /api/stringing/earnings failed', { step }, err);
    return NextResponse.json({ error: 'read_failed', step }, { status: 503 });
  }
}
