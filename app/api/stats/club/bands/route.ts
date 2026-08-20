import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { computeClubBands, MIN_COHORT } from '@/lib/clubBands';
import { normalizeStatsPrivacy, isComparisonRevealed } from '@/lib/statsPrivacy';
import type { Rating, StoredAssessment } from '@/lib/assessment';

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

interface AssessmentDoc extends StoredAssessment {
  memberId?: string;
}

/** Latest snapshot per member, across the whole club. */
async function latestRatingsByMember(): Promise<Map<string, Rating[]>> {
  await ensureContainer('assessments', '/memberId');
  const { resources } = await getContainer('assessments')
    .items.query({ query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c' })
    .fetchAll();

  const latestAt = new Map<string, string>();
  const latest = new Map<string, Rating[]>();
  for (const doc of resources as AssessmentDoc[]) {
    if (!doc || typeof doc.memberId !== 'string' || typeof doc.takenAt !== 'string') continue;
    if (!Array.isArray(doc.ratings)) continue;
    const seen = latestAt.get(doc.memberId);
    if (seen && seen >= doc.takenAt) continue;
    latestAt.set(doc.memberId, doc.takenAt);
    latest.set(doc.memberId, doc.ratings);
  }
  return latest;
}

/** Name → member id. Mirrors `resolveSubject` in app/api/stats/level/route.ts. */
async function resolveMemberId(name: string): Promise<string> {
  const trimmed = name.trim();
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name',
        parameters: [{ name: '@name', value: trimmed.toLowerCase() }],
      })
      .fetchAll();
    const member = resources[0] as { id?: string } | undefined;
    if (member?.id) return member.id;
  } catch {
    /* fall through to name-derived id */
  }
  return `name:${trimmed.toLowerCase()}`;
}

async function readPrivacy(name: string) {
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT c.statsPrivacy FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();
    return normalizeStatsPrivacy((resources[0] as { statsPrivacy?: unknown } | undefined)?.statsPrivacy);
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

  if (!isFlagOn('NEXT_PUBLIC_FLAG_STATS_V2')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const member = verifyMemberAuth(req);
  const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
  if (!ownsName && !isAdminAuthed(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const [memberId, privacy, byMember] = await Promise.all([
      resolveMemberId(name),
      readPrivacy(name),
      latestRatingsByMember(),
    ]);

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
