/**
 * `POST /api/operator/membership { groupId, memberId, role }` — the
 * OPERATOR OVERRIDE (docs/plans/roles-v2.md, PR 3): set anyone's rank in any
 * club, an organiser's included.
 *
 * BREAK-GLASS, NOT A SCREEN. Nobody removes an organiser (roles v2), which
 * is the rule that makes this necessary: a hijacked account, an organiser
 * who vanished, a club nobody can reach. Three locks, in order — the rate
 * limit (rule 4), the admin cookie of a listed operator (`isOperator`), and
 * the `x-migration-key` header the backfill routes already use — so a stolen
 * cookie alone opens nothing. It is called the way the backfill is, and
 * every use is written down (`recordOperatorAction`) and read back on
 * `GET /api/admin/migrate-groups`.
 *
 * Demoting an organiser is the same operation as them stepping down
 * (`stepDown`), performed by someone else: the club passes on first when
 * they were the last, and the only person in a club is refused
 * (`last_member`) — closing a club is a different intent.
 */
import { NextRequest, NextResponse } from 'next/server';
import { unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { MIGRATION_KEY_HEADER, migrationKeyConfigured, migrationKeyMatches } from '@/lib/migrationKey';
import { isOperator, recordOperatorAction } from '@/lib/operator';
import { readGroup, readMembership, setMembershipRole, stepDown } from '@/lib/groups';
import { groupsOn, featureOff, rateLimited, isGroupIdShape } from '@/lib/groupRoutes';
import type { MembershipRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLES: readonly MembershipRole[] = ['owner', 'admin', 'member'];

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`operator-membership:${getClientIp(req)}`, 5, 15 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();
  const op = await isOperator(req);
  if (!op.ok) return op.reason === 'unauthorized' ? unauthorized() : NextResponse.json({ error: 'operator_only' }, { status: 403 });
  if (!migrationKeyConfigured()) return NextResponse.json({ error: 'migration_key_not_configured' }, { status: 503 });
  if (!migrationKeyMatches(req.headers.get(MIGRATION_KEY_HEADER))) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { groupId, memberId, role } = (body ?? {}) as Record<string, unknown>;
  if (typeof groupId !== 'string' || !isGroupIdShape(groupId)) return NextResponse.json({ error: 'invalid_group' }, { status: 400 });
  if (typeof memberId !== 'string' || !memberId) return NextResponse.json({ error: 'invalid_member' }, { status: 400 });
  if (typeof role !== 'string' || !ROLES.includes(role as MembershipRole)) return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
  const to = role as MembershipRole;

  try {
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const current = await readMembership(groupId, memberId);
    if (!current || current.status !== 'active') return NextResponse.json({ error: 'not_on_roster' }, { status: 404 });

    let handedTo: string | null = null;
    if (current.role !== to) {
      if (current.role === 'owner') {
        const result = await stepDown(groupId, memberId, to as Exclude<MembershipRole, 'owner'>);
        if (result.outcome === 'last_member') return NextResponse.json({ error: 'last_member' }, { status: 409 });
        if (result.outcome === 'not_owner') return NextResponse.json({ error: 'update_failed' }, { status: 500 });
        handedTo = result.handedTo ?? null;
      } else if (!(await setMembershipRole(groupId, memberId, to))) {
        return NextResponse.json({ error: 'update_failed' }, { status: 500 });
      }
    }
    // Recorded AFTER the write and awaited: an override that succeeded but
    // could not be written down answers 500, so the operator knows to look.
    const record = await recordOperatorAction({
      actorMemberId: op.memberId,
      groupId,
      targetMemberId: memberId,
      action: 'set_role',
      before: current.role,
      after: to,
      handedTo,
    });
    return NextResponse.json({ groupId, memberId, before: current.role, after: to, handedTo, recordId: record.id });
  } catch (error) {
    console.error('POST /api/operator/membership:', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
