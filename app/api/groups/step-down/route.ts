/**
 * `POST /api/groups/step-down { to: 'admin' | 'member' }` — an organiser gives
 * the rank up themselves, in the club their admin cookie names.
 *
 * THE ONE WAY AN ORGANISER STOPS BEING ONE (docs/plans/roles-v2.md): nobody
 * removes an organiser — not another organiser, not an admin — so the role
 * routes refuse them (`owner_immutable`) and this route is where the rank is
 * given up. It is a different intent from a roster edit, with its own sheet,
 * which is why `PATCH /api/groups/members/[memberId]` refuses self-targeting
 * rather than letting one mis-tap on a roster row cost an admin their
 * standing.
 *
 * If they were the last organiser the club passes on first — longest-serving
 * admin, else longest-serving player — so nobody steps down into a club with
 * no one in charge; the only organiser of a club with nobody else on it is
 * refused (`last_member`), because stepping down must not close a club.
 *
 * The admin cookie keeps working as long as the new rank is `admin`
 * (`isAdminAuthedWithMember` re-reads the membership on every request), and
 * stops at once for `member`; the sheet reloads either way, because the
 * shell's own idea of "admin" was read before the change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { clearAdminCookie, isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { stepDown } from '@/lib/groups';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupsOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`groups-step-down:${getClientIp(req)}`, 10, 15 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  if (!auth.organiser) return NextResponse.json({ error: 'organiser_only' }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const to = (body as Record<string, unknown>)?.to;
  if (to !== 'admin' && to !== 'member') return NextResponse.json({ error: 'invalid_role' }, { status: 400 });

  try {
    const result = await stepDown(auth.groupId, auth.memberId, to);
    if (result.outcome === 'not_owner') return NextResponse.json({ error: 'organiser_only' }, { status: 403 });
    if (result.outcome === 'last_member') return NextResponse.json({ error: 'last_member' }, { status: 409 });
    const res = NextResponse.json({ role: result.role, handedTo: result.handedTo ?? null });
    // A player holds no admin cookie. The async check would refuse it on the
    // next request anyway; clearing it keeps the sync, signature-only reads
    // (`isAdminAuthed`, the shell's own probe) from saying "admin" first.
    if (to === 'member') clearAdminCookie(res);
    return res;
  } catch (error) {
    console.error('POST /api/groups/step-down:', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
