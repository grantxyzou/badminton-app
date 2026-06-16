import { NextRequest, NextResponse } from 'next/server';
import { getContainer, ensureContainer, getActiveSessionId } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { getCanonicalLevel, type LevelSubject } from '@/lib/levelStore';
import { summarizeAssessmentTrend, type StoredAssessment } from '@/lib/assessment';
import { recommendDrills } from '@/lib/drills';

/**
 * Practice drills for a member's weakest skills — private by design, same gate
 * as /api/stats/level: served only to the member (matching `member_session`
 * cookie) or an admin, since the drills are derived from private work-on skills.
 *
 * Order follows the security rules: rate limit (rule 4) → flag (404 off) →
 * privacy gate (rule 12 posture) → resolve subject → derive.
 */

export const dynamic = 'force-dynamic';

/** Name → subject id. Mirrors `resolveSubject` in app/api/stats/level/route.ts. */
async function resolveSubject(name: string): Promise<LevelSubject> {
  const trimmed = name.trim();
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name',
        parameters: [{ name: '@name', value: trimmed.toLowerCase() }],
      })
      .fetchAll();
    const member = resources[0] as { id?: string } | undefined;
    if (member?.id) return { memberId: member.id, name: trimmed };
  } catch {
    /* fall through to name-derived id */
  }
  return { memberId: `name:${trimmed.toLowerCase()}`, name: trimmed };
}

/** Latest work-on skills for a member (lowest-rated), or [] when none/unavailable. */
async function fetchWorkOn(memberId: string) {
  try {
    await ensureContainer('assessments', '/memberId');
    const { resources } = await getContainer('assessments').items
      .query({
        query: 'SELECT c.memberId, c.takenAt, c.ratings, c.overall, c.phase FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    const docs = (resources as (StoredAssessment & { memberId?: string })[]).filter(
      (d) => d && d.memberId === memberId && typeof d.takenAt === 'string',
    );
    return summarizeAssessmentTrend(docs)?.workOn ?? [];
  } catch (err) {
    console.error('stats/drills: workOn read failed:', err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-drills:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_DRILLS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Privacy gate: own this name (member cookie) or admin. Same posture as /level.
  const member = verifyMemberAuth(req);
  const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
  if (!ownsName && !isAdminAuthed(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const subject = await resolveSubject(name);
    const [workOn, level, rotationSeed] = await Promise.all([
      fetchWorkOn(subject.memberId),
      getCanonicalLevel(subject).then((l) => l.level),
      getActiveSessionId(),
    ]);
    const drills = recommendDrills({ workOn, level, rotationSeed });
    return NextResponse.json({ drills });
  } catch (error) {
    console.error('GET stats/drills error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
