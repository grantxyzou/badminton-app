import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ownsNameOrAdmin, verifyMemberAuth } from '@/lib/auth';
import { computeClubBands, MIN_COHORT } from '@/lib/clubBands';
import { normalizeStatsPrivacy, isComparisonRevealed } from '@/lib/statsPrivacy';
import type { Rating } from '@/lib/assessment';
import { resolveActiveSubject } from '@/lib/memberResolve';
import { resolveGroupId } from '@/lib/groupContext';
import { rosterMemberIds } from '@/lib/roster';
import { latestRatingsByMember } from '@/lib/latestRatings';
import { isFlagOn } from '@/lib/flags';

/**
 * Club comparison bands for one member — private by design, same gate as
 * /api/stats/level: served only to the member (matching `member_session`
 * cookie) or an admin.
 *
 * Order follows the security rules: rate limit (rule 4) → flag (404 off) →
 * privacy gate (rule 12 posture) → resolve → derive.
 *
 * THE COMPARISON IS ENFORCED HERE, NOT IN THE CLIENT. A client flag cannot
 * protect data — someone with devtools can flip a bundle constant but cannot
 * flip this. Two separate things are gated:
 *
 *   - `skills` (the member's own band) is withheld unless
 *     `isComparisonRevealed(privacy)` — the preference is ON *and* the
 *     first-run prompt has been ANSWERED. Returning bands to an unasked member
 *     would let the card paint one behind the consent sheet's translucent
 *     backdrop, leaking the answer to the question being asked.
 *   - `dimensionMedians` (the club spread) is returned regardless, because
 *     opting out is not reciprocal: it hides your own place, not everyone
 *     else's. Withholding the spread would make a privacy choice cost
 *     something.
 *
 * `cohort` is returned even when it is below `minCohort`, so the client can
 * tell "not enough people yet" apart from "the read failed" — those must never
 * render as the same thing.
 */

export const dynamic = 'force-dynamic';

/**
 * THE CLUB IS THE ROSTER, not the deployment. `assessments` is PERSON-scoped —
 * one account, many groups — so an aggregate over it must be narrowed to the
 * group's people first, or one club's bands are computed from another club's
 * players. That is the rule `lib/groupScope.ts` states for every club AGGREGATE
 * over a PERSON container, and `rosterMemberIds` is what makes it callable.
 *
 * The narrowing applies ONLY with the flag on. Flag off, `rosterMemberIds`
 * would answer "every ACTIVE member", which is very nearly the same set but not
 * exactly: a soft-deleted member's assessments count toward the club today.
 * Dropping them is a defensible correction and NOT this change — flag off,
 * nothing observable moves, so it rides in with the cutover.
 *
 * A SYNTHETIC SUBJECT IS NOT A CLUB MEMBER, and is excluded unconditionally.
 * `POST /api/assessments` deliberately stays open to a name matching no member
 * — anonymous self-assessment is a shipped decision, and a name with no member
 * record has nobody to impersonate — but it stores those rows under
 * `memberId = 'name:<lower>'`, and this fold counted them. So an
 * unauthenticated caller could invent cohort members: post all-5s under a
 * stream of made-up names, push the cohort past `MIN_COHORT` so bands compute
 * at all, and move every real member's band. `lib/levelStore.ts` already drops
 * these rows for exactly this reason; this is the same rule reaching the other
 * aggregate over the same container. The roster narrowing above does NOT cover
 * it — that is flag-gated, and the flag is off in production, so nothing else
 * excludes them today.
 */
async function clubRatings(groupId: string, viewerId: string): Promise<Map<string, Rating[]>> {
  // The fold of every member's latest check-in is memoized process-wide and
  // cleared by every assessment writer (lib/latestRatings.ts). Who COUNTS is
  // decided here, on each request, from that fold.
  const [roster, all] = await Promise.all([
    isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') ? rosterMemberIds(groupId) : Promise.resolve(null),
    latestRatingsByMember(),
  ]);
  const latest = new Map<string, Rating[]>();
  for (const [memberId, { ratings }] of all) {
    // A synthetic `name:` subject is not a club member and gets no vote on the
    // median (see the docstring). The viewer keeps their own row.
    if (memberId !== viewerId && memberId.startsWith('name:')) continue;
    // THE VIEWER IS ALWAYS ADMITTED, roster or not. The filter answers "who is
    // the club", and the viewer's own band is not a club statistic — dropping
    // it renders their own row as "no data" while the cohort around it paints.
    // Two ways to be off the roster and still be looking at this page: a
    // membership set `removed` while a 30-day `member_session` is still valid,
    // and a synthetic `name:` subject (an admin viewing an unclaimed player).
    if (roster && memberId !== viewerId && !roster.has(memberId)) continue;
    latest.set(memberId, ratings);
  }
  return latest;
}

/** Name → member id. Mirrors `resolveSubject` in app/api/stats/level/route.ts. */

/** By the RESOLVED id, never by name: the consent gate and the data it gates must be one person. */
async function readPrivacy(memberId: string) {
  try {
    const { resource } = await getContainer('members').item(memberId, memberId).read<{ statsPrivacy?: unknown; active?: boolean }>();
    if (!resource || resource.active !== true) return { clubComparison: false, promptedAt: null };
    return normalizeStatsPrivacy(resource.statsPrivacy);
  } catch {
    // Fail CLOSED: an unreadable preference must not be treated as consent.
    return { clubComparison: false, promptedAt: null };
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-club-bands:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const groupId = resolveGroupId(req);
    const memberId = (await resolveActiveSubject(groupId, name, verifyMemberAuth(req))).memberId;
    const [privacy, byMember] = await Promise.all([readPrivacy(memberId), clubRatings(groupId, memberId)]);

    const viewer = byMember.get(memberId) ?? [];
    const others: Rating[][] = [];
    for (const [id, ratings] of byMember) {
      if (id !== memberId) others.push(ratings);
    }

    const result = computeClubBands({ viewer, others, minCohort: MIN_COHORT });

    // The consent invariant, enforced server-side.
    const revealed = isComparisonRevealed(privacy);
    return NextResponse.json({
      cohort: result.cohort,
      minCohort: result.minCohort,
      dimensionMedians: result.dimensionMedians,
      skills: revealed ? result.skills : [],
    });
  } catch (error) {
    console.error('GET stats/club/bands error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
