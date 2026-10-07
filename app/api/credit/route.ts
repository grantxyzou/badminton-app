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
import { balanceOf, creditLedgerFor } from '@/lib/storeCredit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`credit:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  try {
    const entries = await creditLedgerFor(groupScope(resolveGroupId(req)), member.memberId);
    return NextResponse.json({
      balanceCents: balanceOf(entries),
      entries: entries.slice(0, 20).map(({ id, kind, amountCents, note, createdAt }) => ({ id, kind, amountCents, note, createdAt })),
    });
  } catch (err) {
    console.error('GET /api/credit failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
