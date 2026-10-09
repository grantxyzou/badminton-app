/**
 * Gift cards, admin side (docs/plans/payments.md, docs/plans/gift-card-ledger.md).
 *   GET  — the club's cards, each with its record: amount, note, last four,
 *          who made it, who redeemed it and when, and how much of it has
 *          been drawn and on what (the oldest-source-first reading in
 *          `lib/creditAttribution.ts`). Never the code itself: only its hash
 *          is stored.
 *   POST { amountCents, note } — mint one. The code is in THIS response only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { getContainer } from '@/lib/cosmos';
import { CreditError, giftCardRecords, mintGiftCard } from '@/lib/storeCredit';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/** Display names for a few member ids; an id with no Member (deleted) stays unnamed. */
async function namesOf(ids: Iterable<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const container = getContainer('members');
  await Promise.all([...new Set(ids)].map(async (id) => {
    try {
      const { resource } = await container.item(id, id).read<Member>();
      if (resource?.name) out.set(id, resource.name);
    } catch (err) {
      if ((err as { code?: number })?.code !== 404) throw err;
    }
  }));
  return out;
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-giftcards:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const records = await giftCardRecords(resolveGroupId(req));
    const names = await namesOf(records.flatMap((r) => [r.createdBy, ...(r.redeemedBy ? [r.redeemedBy] : [])]));
    const person = (id: string | undefined) => (id ? { memberId: id, name: names.get(id) ?? null } : null);
    return NextResponse.json({
      cards: records.map(({ id, amountCents, note, hint, createdAt, createdBy, redeemedAt, redeemedBy, usedCents, remainingCents, uses }) => ({
        id, amountCents, note, hint, createdAt,
        createdBy: person(createdBy),
        redeemedAt: redeemedAt ?? null,
        redeemedBy: person(redeemedBy),
        usedCents, remainingCents,
        uses: uses.map(({ at, amountCents, note, kind, reversed }) => ({ at, amountCents, note, kind, reversed: reversed === true })),
      })),
    });
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
