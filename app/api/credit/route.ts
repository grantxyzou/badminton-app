/**
 * GET /api/credit — the signed-in member's own store credit in this club:
 * balance and recent entries (docs/plans/payments.md). Never anyone else's.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { balanceOf, creditLedgerFor, refundStaleSpends } from '@/lib/storeCredit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`credit:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  const scope = groupScope(resolveGroupId(req));
  // A spend whose row was since paid another way is reconciled here too, so a
  // member with nothing left to pay gets the credit back when they look.
  // Best-effort: the balance is read either way.
  try {
    await refundStaleSpends(scope, member.memberId);
  } catch (err) {
    console.warn('GET /api/credit: stale-spend reconcile skipped', err);
  }
  try {
    const entries = await creditLedgerFor(scope, member.memberId);
    return NextResponse.json({
      balanceCents: balanceOf(entries),
      entries: entries.slice(0, 20).map(({ id, kind, amountCents, note, createdAt }) => ({ id, kind, amountCents, note, createdAt })),
    });
  } catch (err) {
    console.error('GET /api/credit failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
