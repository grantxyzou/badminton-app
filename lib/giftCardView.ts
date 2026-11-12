/**
 * A gift card's RECORD as both organiser surfaces show it: the console's
 * Credit codes card (`GET /api/admin/giftcards`) and Profile's Give credit
 * page (`GET /api/giftcards`). One shape from one place, so the two doors
 * cannot disagree (docs/plans/gift-card-ledger.md, review of 2026-11-12:
 * Grant opened the Profile list and found none of who, when, where it was
 * spent or what is left, all of which the console already had).
 *
 * Never the code itself: only its hash is stored.
 */
import { getContainer } from './cosmos';
import { giftCardRecords } from './storeCredit';
import type { Member } from './types';

export interface GiftCardPerson { memberId: string; name: string | null }
export interface GiftCardUseView { at: string; amountCents: number; note: string; kind: string; reversed: boolean }
export interface GiftCardView {
  id: string;
  amountCents: number;
  note: string;
  hint: string;
  createdAt: string;
  createdBy: GiftCardPerson | null;
  redeemedAt: string | null;
  redeemedBy: GiftCardPerson | null;
  usedCents: number | null;
  remainingCents: number | null;
  uses: GiftCardUseView[];
}

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

/** The club's cards, each with its record and the people on it named. Throws on a read failure. */
export async function giftCardViews(groupId: string): Promise<GiftCardView[]> {
  const records = await giftCardRecords(groupId);
  const names = await namesOf(records.flatMap((r) => [r.createdBy, ...(r.redeemedBy ? [r.redeemedBy] : [])]));
  const person = (id: string | undefined): GiftCardPerson | null => (id ? { memberId: id, name: names.get(id) ?? null } : null);
  return records.map(({ id, amountCents, note, hint, createdAt, createdBy, redeemedAt, redeemedBy, usedCents, remainingCents, uses }) => ({
    id, amountCents, note, hint, createdAt,
    createdBy: person(createdBy),
    redeemedAt: redeemedAt ?? null,
    redeemedBy: person(redeemedBy),
    usedCents, remainingCents,
    uses: uses.map(({ at, amountCents, note, kind, reversed }) => ({ at, amountCents, note, kind, reversed: reversed === true })),
  }));
}
