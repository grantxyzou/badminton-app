import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as myCards, POST as mintAsMember } from '@/app/api/giftcards/route';
import { GET as adminCards } from '@/app/api/admin/giftcards/route';
import { mintGiftCard } from '@/lib/storeCredit';
import { resetMockStore, getStore, seedMember, makeRequest, makeAdminRequest, memberCookieValue, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The two-club gate for gift cards (docs/plans/gift-card-ledger.md): a card
 * minted in another club is invisible to BPM's gifter and admin lists, and a
 * BPM gifter's card is stamped bpm.
 */

const BASE = 'http://localhost:3000/api';

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
});

describe('gift cards group isolation', () => {
  it("another club's cards never appear in BPM's lists, and a BPM mint is stamped bpm", async () => {
    const zach = seedMember('Zach', { canGift: true });
    const asZach = { Cookie: `member_session=${memberCookieValue('Zach', zach.id)}` };
    // Zach also made a card for the OTHER club.
    await mintGiftCard('other', { amountCents: 700, note: 'Elsewhere', adminId: zach.id });

    const minted = await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500, note: 'Here' }, asZach));
    expect(minted.status).toBe(200);

    const mine = await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).json();
    expect(mine.cards.map((c: { note: string }) => c.note)).toEqual(['Here']);

    const { cards } = await (await adminCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards.map((c: { note: string }) => c.note)).toEqual(['Here']);

    const docs = (getStore()['clubSettings'] as Array<{ kind?: string; note?: string; groupId?: string; id: string }>).filter((d) => d.kind === 'giftcard');
    expect(docs.find((d) => d.note === 'Here')).toMatchObject({ groupId: 'bpm' });
    expect(docs.find((d) => d.note === 'Elsewhere')).toMatchObject({ groupId: 'other' });
    expect(docs.find((d) => d.note === 'Elsewhere')!.id.startsWith('other:')).toBe(true);
  });
});
