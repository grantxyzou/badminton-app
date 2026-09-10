import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { resolveGroupId } from '@/lib/groupContext';
import { rosterMemberIds } from '@/lib/roster';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { tallyClubGear, CLUB_GEAR_MIN_COHORT } from '@/lib/clubGear';
import type { PlayerGear } from '@/lib/types';

/**
 * What the club plays — an aggregate tally of everyone's kit.
 *
 * COUNTS ONLY, NEVER NAMES. There is no parameter that would return who owns
 * what, and the shape has no seam for one: an entry is a label and a number.
 * This is the reciprocity the privacy screen promises ("Nine players use BG65
 * — a tally, never who"), and it is the reason logging your own kit is worth
 * anything to anyone else.
 *
 * Entries below `minCohort` are DROPPED, not returned with a small count. In a
 * twelve-person club "1 player uses X" plus a bit of gossip is a name, which
 * is precisely what this endpoint promises never to be.
 *
 * Deliberately unauthenticated: the response contains no member data at all,
 * only aggregate counts already visible to anyone who looks at the racket bags
 * on court. It is flag-gated and rate-limited like its neighbours.
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-club-gear:${ip}`, 30, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    await ensureContainer('playerGear', '/memberId');
    // See the note in stats/club/bands: `playerGear` is PERSON-scoped, so a
    // club tally over it counts other clubs' bags unless it is narrowed to the
    // roster. `c.memberId` had to join the projection — without it there was
    // nothing on the row to narrow BY.
    const roster = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') ? await rosterMemberIds(resolveGroupId(req)) : null;
    const { resources } = await getContainer('playerGear')
      .items.query({ query: 'SELECT c.memberId, c.items FROM c' })
      .fetchAll();
    const rows = (resources as (Pick<PlayerGear, 'items'> & { memberId?: string })[]).filter(
      (r) => !roster || (typeof r.memberId === 'string' && roster.has(r.memberId)),
    );

    const entries = tallyClubGear(rows);
    return NextResponse.json({ minCohort: CLUB_GEAR_MIN_COHORT, entries });
  } catch (error) {
    console.error('GET stats/club/gear error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
