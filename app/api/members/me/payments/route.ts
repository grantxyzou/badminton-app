/**
 * GET /api/members/me/payments?months=6 — what the signed-in member has PAID
 * in this club, month by month: sessions, stringing and their guests' shares,
 * in cents (lib/memberPayments.ts). Profile → Account balance draws its chart
 * from it (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §4).
 *
 * Always the caller's own: the member cookie names the person, the club is
 * the one the cookie claims, and there is no name or id to ask about anyone
 * else with. An admin_session alone is not enough: this is a member's own
 * history, and an admin has the club's ledger for everyone's.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { resolveIdentity } from '@/lib/playerIdentity';
import { memberPayments, PAYMENT_MONTHS_DEFAULT, PAYMENT_MONTHS_MAX } from '@/lib/memberPayments';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Rate limit before auth (security rule 4).
  if (!checkRateLimit(`member-payments:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();

  const asked = Number(req.nextUrl.searchParams.get('months') ?? PAYMENT_MONTHS_DEFAULT);
  const months = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, PAYMENT_MONTHS_MAX) : PAYMENT_MONTHS_DEFAULT;

  try {
    const groupId = resolveGroupId(req);
    const identity = await resolveIdentity({ memberId: member.memberId, name: member.name }, groupId);
    // Rows signed up under the club's name for them before a rename.
    identity.names.add(member.name.toLowerCase());
    return NextResponse.json({ months: await memberPayments(groupScope(groupId), identity, months) });
  } catch (err) {
    console.error('GET /api/members/me/payments failed', err);
    // A failed read is a 503, never an empty history (the lying-empty-state rule).
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
