import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isAdminAuthed, verifyMemberAuth } from '@/lib/auth';
import { getCanonicalLevel, type LevelSubject } from '@/lib/levelStore';

/**
 * Canonical level for a member — private by design (CLAUDE.md privacy stance):
 * served only to the member themselves (a matching `member_session` cookie) or
 * an admin. Never ranked, never listed. Read-only ⇒ the cheap sync
 * `isAdminAuthed` is fine (rule 3).
 *
 * Order follows the security rules: rate limit (rule 4) → flag (404 when off) →
 * privacy gate (rule 12 posture) → resolve subject → derive.
 */

export const dynamic = 'force-dynamic';

/**
 * Name → subject id. Mirrors `resolveSubject` in app/api/assessments/route.ts:
 * the members directory is canonical; non-members fall back to a name-derived
 * key so they still get a (self-only) level. Queries by @name, which the mock
 * store honors (it does NOT honor @memberId).
 */
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

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`stats-level:${ip}`, 60, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_LEVEL')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const name = new URL(req.url).searchParams.get('name')?.trim().slice(0, 50) ?? '';
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  // Privacy gate: the calling device must own this name (member cookie) or be
  // an admin. A known-not-authed caller gets 403 (the client renders an
  // actionable "sign in again" state — unknown ≠ known-false).
  const member = verifyMemberAuth(req);
  const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
  if (!ownsName && !isAdminAuthed(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const subject = await resolveSubject(name);
    const level = await getCanonicalLevel(subject);
    return NextResponse.json({ level });
  } catch (error) {
    console.error('GET stats/level error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
