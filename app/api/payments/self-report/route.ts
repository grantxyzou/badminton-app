/**
 * POST /api/payments/self-report — "I've sent it" from the Home balance card.
 *
 * Flags every session line the signed-in member currently owes with
 * `selfReportedPaid`, the field the admin's PaymentsCard already tags. It does
 * NOT mark anything paid: a tap is a claim, the e-transfer is the evidence,
 * and the inbox (or the admin) is what turns one into `paid`.
 *
 * Authenticated by the member's own `member_session`, never a name: the old
 * self-report path in PATCH /api/players took a `deleteToken`, which lives in
 * one browser and only for the ACTIVE session — and owed sessions are past
 * ones by definition.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { resolveIdentity } from '@/lib/playerIdentity';
import { computeOwed } from '@/lib/owedBalance';
import type { Player } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`self-report:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();

  try {
    const scope = groupScope(resolveGroupId(req));
    const identity = await resolveIdentity({ memberId: member.memberId }, scope.groupId);
    const { sessions } = await computeOwed(scope, identity);
    let flagged = 0;
    for (const s of sessions) {
      const row = await scope.read<Player & Record<string, unknown>>('players', s.playerId, s.sessionId);
      if (!row || row.paid === true || row.selfReportedPaid === true) continue;
      if (await scope.replace('players', { ...row, selfReportedPaid: true }, s.sessionId)) flagged += 1;
    }
    return NextResponse.json({ ok: true, flagged });
  } catch (err) {
    console.error('POST /api/payments/self-report failed', err);
    return NextResponse.json({ error: 'self_report_failed' }, { status: 500 });
  }
}
