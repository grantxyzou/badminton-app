/**
 * Gift cards, for a member with `canGift` (docs/plans/gift-card-ledger.md).
 *
 *   GET  — `{ canGift }`, plus the caller's own cards (amount, note, last
 *          four, redeemed or not — never who redeemed it; that is the
 *          admin's record) when they may give them out.
 *   POST { amountCents, note } — mint one. The code is in THIS response only.
 *
 * The switch is re-read on every call, like `canString`: a cookie that was
 * minted while the switch was on does not keep it. With groups on it is read
 * from THIS club's membership, not the Member — see `canGift` below. Admins
 * mint from the console (`/api/admin/giftcards`); this surface is for the
 * helper who is not one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { getContainer } from '@/lib/cosmos';
import { readMembership } from '@/lib/groups';
import { CreditError, listGiftCards, mintGiftCard } from '@/lib/storeCredit';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * Fresh, never from the cookie: the roster switch is the authority.
 *
 * With groups on, the switch is the one on THIS club's membership. A card is
 * the club's liability, and a person can be on two rosters: a helper one club
 * trusts with gift cards would otherwise mint against the other club they
 * happen to belong to, because nothing on the Member says WHICH club granted
 * it. Flag off, the Member's switch as it always was.
 */
async function canGift(req: NextRequest, memberId: string): Promise<boolean> {
  if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) {
    const m = await readMembership(resolveGroupId(req), memberId);
    return m?.status === 'active' && m.canGift === true;
  }
  const { resource } = await getContainer('members').item(memberId, memberId).read<Member>();
  return resource?.active === true && resource.canGift === true;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`giftcards:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const me = await requireGroupMember(req);
  if (!me) return unauthorized();
  try {
    if (!(await canGift(req, me.memberId))) return NextResponse.json({ canGift: false, cards: [] });
    const cards = (await listGiftCards(resolveGroupId(req))).filter((c) => c.createdBy === me.memberId);
    return NextResponse.json({
      canGift: true,
      cards: cards.map(({ id, amountCents, note, hint, createdAt, redeemedAt }) => ({ id, amountCents, note, hint, createdAt, redeemedAt: redeemedAt ?? null })),
    });
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
  if (!(await canGift(req, me.memberId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  // A gifter is not an admin: a per-person ceiling on top of the per-IP one,
  // because every card is club liability the moment it is redeemed.
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
