/**
 * Gift cards, admin side (docs/plans/payments.md, docs/plans/gift-card-ledger.md).
 *   GET  — the club's cards, each with its record: amount, note, last four,
 *          who made it, who redeemed it and when, and how much of it has
 *          been drawn and on what (the oldest-source-first reading in
 *          `lib/creditAttribution.ts`). Never the code itself: only its hash
 *          is stored.
 *   POST { amountCents, note } — mint one. The code is in THIS response only.
 *
 * Both are an ORGANISER's (Grant, 2026-11-10: "gift card should be organizer
 * feature only"): a card is money the club owes, the rank above admin is the
 * one that hands out money-shaped powers (docs/roles.md), and the records name
 * who redeemed what. An admin who is not an organiser gets 403 organiser_only.
 * With groups off every admin is an organiser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { CreditError, mintGiftCard } from '@/lib/storeCredit';
import { giftCardViews } from '@/lib/giftCardView';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
const organiserOnly = () => NextResponse.json({ error: 'organiser_only' }, { status: 403 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-giftcards:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  if (!admin.organiser) return organiserOnly();
  try {
    return NextResponse.json({ cards: await giftCardViews(resolveGroupId(req)) });
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
  if (!admin.organiser) return organiserOnly();
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
