/**
 * POST /api/credit/spend — "Pay with credit": the signed-in member pays the
 * owed lines their credit covers in full, oldest first (lib/storeCredit.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { CreditError, payWithCredit } from '@/lib/storeCredit';
import { releaseHoldIfSettled } from '@/lib/paymentsInbox';
import { groupScope } from '@/lib/groupScope';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`credit-spend:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  const groupId = resolveGroupId(req);
  try {
    const result = await payWithCredit(groupId, member.memberId);
    if (result.paid > 0 && isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
      await releaseHoldIfSettled(groupScope(groupId), member.memberId);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error('POST /api/credit/spend failed', err);
    return NextResponse.json({ error: 'spend_failed' }, { status: 500 });
  }
}
