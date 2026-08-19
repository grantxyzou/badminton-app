import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { verifyMemberAuth, isAdminAuthedWithMember } from '@/lib/auth';
import { SKILLS, scoreAssessment, placePhase, type Rating } from '@/lib/assessment';

export const dynamic = 'force-dynamic';

// Lazy container bootstrap — real Cosmos doesn't auto-create containers.
// Personal trend store, keyed per-person so snapshots accumulate over time.
let ready: Promise<void> | null = null;
function ensureAssessments(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('assessments', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

const SKILL_KEYS = new Set(SKILLS.map((s) => s.key));

/**
 * Validate + normalize incoming ratings. Drops unknown skills and
 * out-of-range values; de-dupes by skillKey (last wins). Always stamps
 * source: 'self' (P0). Returns null if nothing valid remains.
 */
function validateRatings(raw: unknown): Rating[] | null {
  if (!Array.isArray(raw)) return null;
  const byKey = new Map<string, Rating>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const skillKey = (r as { skillKey?: unknown }).skillKey;
    const value = (r as { value?: unknown }).value;
    if (typeof skillKey !== 'string' || !SKILL_KEYS.has(skillKey)) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) continue;
    byKey.set(skillKey, { skillKey, value, source: 'self' });
  }
  return byKey.size > 0 ? [...byKey.values()] : null;
}

/**
 * Resolve a player name to a stable subject id. The members container is the
 * canonical per-person store (post memberId migration); fall back to a
 * name-derived key so a player who isn't yet a member still gets a trend.
 * Queries by @name, which the mock store honors (it does NOT honor @memberId).
 *
 * `isMember` is returned explicitly (rather than inferred later from a
 * `memberId.startsWith('name:')` string check) so the write-auth gate below
 * doesn't depend on the shape of the fallback id.
 */
async function resolveSubject(name: string): Promise<{ memberId: string; name: string; isMember: boolean }> {
  const trimmed = name.trim();
  try {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = @name',
        parameters: [{ name: '@name', value: trimmed.toLowerCase() }],
      })
      .fetchAll();
    const member = resources[0] as { id?: string } | undefined;
    if (member?.id) return { memberId: member.id, name: trimmed, isMember: true };
  } catch {
    /* fall through to name-derived id */
  }
  return { memberId: `name:${trimmed.toLowerCase()}`, name: trimmed, isMember: false };
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`assessments:${ip}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });

    const ratings = validateRatings(body.ratings);
    if (!ratings) return NextResponse.json({ error: 'ratings_required' }, { status: 400 });

    const subject = await resolveSubject(name);

    // Member-scoped write (Security Rule 12): a name that resolves to a real
    // member can only be written by that member's own member_session cookie
    // or an admin — closes the impersonation gap where any visitor could pick
    // a name (e.g. via the stats preview-name picker) and post ratings
    // attributed to someone else. A name with NO member record has nothing to
    // impersonate, so anonymous self-assessment stays open (decision 1).
    // `needs_signin` is a distinguishable 401 (decision 2): covers both "no
    // cookie" and "cookie for a different member" — verifyMemberAuth already
    // collapses missing/invalid/expired cookies to null, so an expired
    // member_session (30-day TTL vs indefinite localStorage identity) lands
    // here too, and the client can route the user to sign in again rather
    // than showing a generic save error.
    if (subject.isMember) {
      const caller = verifyMemberAuth(req);
      const isSelf = !!caller && caller.memberId === subject.memberId;
      if (!isSelf && !(await isAdminAuthedWithMember(req)).authed) {
        return NextResponse.json({ error: 'needs_signin' }, { status: 401 });
      }
    }

    await ensureAssessments();
    const score = scoreAssessment(ratings);
    const record = {
      id: randomBytes(16).toString('hex'),
      memberId: subject.memberId,
      name: subject.name,
      takenAt: new Date().toISOString(),
      ratings,
      overall: score.overall,
      dimensionScores: score.dimensionScores,
      phase: placePhase(score.overall),
    };
    const { resource } = await getContainer('assessments').items.create(record);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST assessments error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_SKILL_ASSESS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const name = new URL(req.url).searchParams.get('name');
  if (!name || !name.trim()) return NextResponse.json({ assessments: [] });
  try {
    await ensureAssessments();
    const subject = await resolveSubject(name);
    const { resources } = await getContainer('assessments')
      .items.query({
        query: 'SELECT * FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: subject.memberId }],
      })
      .fetchAll();
    // JS-side filter + sort — the mock store ignores @memberId and ORDER BY.
    const assessments = resources
      .filter((a) => a.memberId === subject.memberId)
      .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
    return NextResponse.json({ assessments });
  } catch (error) {
    console.error('GET assessments error:', error);
    return NextResponse.json({ error: 'load_failed' }, { status: 500 });
  }
}
