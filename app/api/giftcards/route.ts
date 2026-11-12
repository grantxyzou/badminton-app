/**
 * Gift cards from Profile → "Give a gift card", for an ORGANISER of this club
 * (docs/plans/gift-card-ledger.md; Grant, 2026-11-10: "gift card should be
 * organizer feature only").
 *
 *   GET  — `{ canGift }`, plus the caller's own cards when they may give
 *          them out, each with the same RECORD the console shows (who made
 *          it, who redeemed it and when, what it was spent on, what is left;
 *          `lib/giftCardView.ts`). Only an organiser gets here, so the old
 *          reason to hide the redeemer (a non-admin helper could give cards)
 *          went with the `canGift` switch (review of 2026-11-12).
 *   POST { amountCents, note } — mint one. The code is in THIS response only.
 *
 * The rank is re-read on every call (`requireGroupMember` reads the
 * membership), so an organiser who steps down stops at once. It replaced the
 * `canGift` switch, which let an organiser hand minting to a helper; the
 * response keeps the `canGift` name so an older Profile still reads it.
 * The console mints through `/api/admin/giftcards`, organiser-only too.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { CreditError, mintGiftCard } from '@/lib/storeCredit';
import { giftCardViews } from '@/lib/giftCardView';
import type { MembershipRole } from '@/lib/types';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * An organiser of the club the cookie names. The role is the one
 * `requireGroupMember` just re-read from THIS club's membership (a card is
 * this club's liability; an organiser of another club is nobody here). With
 * groups off there is no organiser rank, and every admin is one
 * (`docs/roles.md`), as `isAdminAuthedWithMember` answers.
 */
function canGift(role: MembershipRole): boolean {
  if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return role === 'owner';
  return role === 'admin' || role === 'owner';
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`giftcards:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const me = await requireGroupMember(req);
  if (!me) return unauthorized();
  try {
    if (!canGift(me.role)) return NextResponse.json({ canGift: false, cards: [] });
    const cards = (await giftCardViews(resolveGroupId(req))).filter((c) => c.createdBy?.memberId === me.memberId);
    return NextResponse.json({ canGift: true, cards });
  } catch (err) {
    console.error('GET /api/giftcards failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`giftcards-mint:${getClientIp(req)}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const me = await requireGroupMember(req);
  if (!me) return unauthorized();
  if (!canGift(me.role)) return NextResponse.json({ error: 'organiser_only' }, { status: 403 });
  // A per-person ceiling on top of the per-IP one, because every card is club
  // liability the moment it is redeemed.
  if (!checkRateLimit(`giftcards-mint:member:${me.memberId}`, 10, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
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
      adminId: me.memberId,
    });
    return NextResponse.json({ code, amountCents: card.amountCents, note: card.note }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: err.code }, { status: 400 });
    console.error('POST /api/giftcards failed', err);
    return NextResponse.json({ error: 'mint_failed' }, { status: 500 });
  }
}
