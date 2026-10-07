/**
 * Gift cards, admin side (docs/plans/payments.md).
 *   GET  — the club's cards: amount, note, last four, redeemed or not. Never
 *          the code itself: only its hash is stored.
 *   POST { amountCents, note } — mint one. The code is in THIS response only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { CreditError, listGiftCards, mintGiftCard } from '@/lib/storeCredit';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-giftcards:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const cards = await listGiftCards(resolveGroupId(req));
    return NextResponse.json({ cards: cards.map(({ id, amountCents, note, hint, createdAt, redeemedAt }) => ({ id, amountCents, note, hint, createdAt, redeemedAt: redeemedAt ?? null })) });
  } catch (err) {
    console.error('GET /api/admin/giftcards failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-giftcards-mint:${getClientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.amountCents !== 'number') return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    const { code, card } = await mintGiftCard(resolveGroupId(req), {
      amountCents: body.amountCents,
      note: typeof body.note === 'string' ? body.note : '',
      adminId: admin.memberId,
    });
    return NextResponse.json({ code, amountCents: card.amountCents, note: card.note }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: err.code }, { status: 400 });
    console.error('POST /api/admin/giftcards failed', err);
    return NextResponse.json({ error: 'mint_failed' }, { status: 500 });
  }
}
