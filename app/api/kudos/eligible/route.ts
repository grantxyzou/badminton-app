/**
 * GET /api/kudos/eligible — who the caller may give kudos to.
 *
 * Exists so the client never GUESSES the eligibility rule. It used to build its
 * list from the active roster (and, before that, from the game log), while the
 * server enforced something different — which is how the card ended up offering
 * a list the POST would refuse, and later offering nothing at all. One owner
 * now: `lib/kudosEligibility.ts`, shared with the POST.
 *
 * Identity comes from the member cookie, never a query param: the list is "who
 * did YOU play with", and a name parameter would let anyone enumerate anyone
 * else's co-players (security rule 12 — names are enumerable).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { getActiveSessionId } from '@/lib/cosmos';
import { eligibleCoPlayers } from '@/lib/kudosEligibility';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`kudos-eligible:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_KUDOS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const member = verifyMemberAuth(req);
  if (!member) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  try {
    const activeSessionId = await getActiveSessionId();
    const names = await eligibleCoPlayers(member.name, activeSessionId);
    return NextResponse.json({ names });
  } catch (error) {
    console.error('GET kudos/eligible error:', error);
    // An explicit failure, never an empty list — an empty list is a CLAIM that
    // there is nobody to thank, and rendering that from a broken read is the
    // lying-empty-state pattern this app has a rule against.
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
