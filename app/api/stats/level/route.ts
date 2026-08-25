import { NextRequest, NextResponse } from 'next/server';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ownsNameOrAdmin } from '@/lib/auth';
import { getCanonicalLevel } from '@/lib/levelStore';
import { resolveActiveSubject } from '@/lib/memberResolve';

/**
 * Canonical level for a member — private by design (CLAUDE.md privacy stance):
 * served only to the member themselves (a matching `member_session` cookie) or
 * an admin. Never ranked, never listed. The gate is `ownsNameOrAdmin`
 * (lib/auth.ts) — read-only ⇒ its cheap sync `isAdminAuthed` is fine (rule 3).
 *
 * Order follows the security rules: rate limit (rule 4) → flag (404 when off) →
 * privacy gate (rule 12 posture) → resolve subject → derive.
 */

export const dynamic = 'force-dynamic';

/**
 * Name → subject id. Mirrors `resolveActiveSubject` in app/api/assessments/route.ts:
 * the members directory is canonical; non-members fall back to a name-derived
 * key so they still get a (self-only) level. Queries by @name, which the mock
 * store honors (it does NOT honor @memberId).
 */

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
  if (!ownsNameOrAdmin(req, name)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const subject = await resolveActiveSubject(name);
    const level = await getCanonicalLevel(subject);
    return NextResponse.json({ level });
  } catch (error) {
    console.error('GET stats/level error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
