/**
 * POST /api/credit/redeem `{ code }` — a member turns a gift card into their
 * own credit. Rate-limited per IP AND per member before any read, because a
 * code is a bearer credential and the limit is what makes guessing one hopeless.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { CreditError, redeemGiftCard } from '@/lib/storeCredit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`redeem:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  if (!checkRateLimit(`redeem:member:${member.memberId}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  let code = '';
  try {
    const body = await req.json();
    code = typeof body.code === 'string' ? body.code.slice(0, 40) : '';
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const entry = await redeemGiftCard(resolveGroupId(req), code, member.memberId);
    return NextResponse.json({ ok: true, amountCents: entry.amountCents });
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: 'gift_not_found' }, { status: 404 });
    console.error('POST /api/credit/redeem failed', err);
    return NextResponse.json({ error: 'redeem_failed' }, { status: 500 });
  }
}
