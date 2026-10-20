/**
 * Grommet hole counts the club's stringer took off a frame
 * (docs/plans/grommet-holes.md, Phase 3).
 *   GET    — the club's counts, `{ counts: { [catalogId]: holes } }`. Any
 *            signed-in member: the racket page shows them.
 *   PUT    — `{ catalogId, holes }`: set or correct one. Admin (the bench's
 *            Set-up screen is admin-only).
 *   DELETE — `?catalogId=`: clear one. Admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, requireMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { HoleCountError, clearHoleCount, readHoleCounts, setHoleCount, validateHoleCount } from '@/lib/holeCounts';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60_000;
const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-holes-read:${getClientIp(req)}`, 120, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const gate = await requireMember(req);
  if (!gate.ok) return gate.response;
  try {
    const counts = await readHoleCounts(groupScope(resolveGroupId(req)));
    return NextResponse.json({ counts });
  } catch (err) {
    console.error('GET /api/stringing/holes failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-holes-write:${getClientIp(req)}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  let input: { catalogId: string; holes: number };
  try {
    input = validateHoleCount((body as Record<string, unknown>).catalogId, (body as Record<string, unknown>).holes);
  } catch (err) {
    if (err instanceof HoleCountError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'already_known' ? 409 : 400 });
    }
    throw err;
  }
  try {
    const doc = await setHoleCount(resolveGroupId(req), input.catalogId, input.holes, admin.memberId);
    return NextResponse.json({ catalogId: doc.catalogId, holes: doc.holes });
  } catch (err) {
    console.error('PUT /api/stringing/holes failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return off();
  if (!checkRateLimit(`stringing-holes-write:${getClientIp(req)}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  const catalogId = new URL(req.url).searchParams.get('catalogId') ?? '';
  if (!/^racket-[a-z0-9-]{1,80}$/.test(catalogId)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    await clearHoleCount(resolveGroupId(req), catalogId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof HoleCountError) return NextResponse.json({ error: err.code }, { status: 404 });
    console.error('DELETE /api/stringing/holes failed', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
