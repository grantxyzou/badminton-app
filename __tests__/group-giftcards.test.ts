import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as myCards, POST as mintAsMember } from '@/app/api/giftcards/route';
import { GET as adminCards } from '@/app/api/admin/giftcards/route';
import { PATCH as membersPatch } from '@/app/api/members/route';
import { mintGiftCard } from '@/lib/storeCredit';
import { readMembership } from '@/lib/groups';
import { rosterMembers } from '@/lib/roster';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
  ADMIN_MEMBER_ID,
} from './helpers';

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

/**
 * THE SWITCH IS THE CLUB'S, NOT THE PERSON'S. Until 2026-10-11 `canGift` was
 * read off the Member, which says nothing about WHICH club trusted the helper:
 * a person on two rosters, granted the switch by one club's admin, could mint
 * a card — that club's liability the moment it is redeemed — against the
 * other. With groups on the mint reads `Membership.canGift` for the club the
 * card is minted in; the Member field is the flag-off value and the rollback
 * copy (`PATCH /api/members` writes both).
 */
describe('gift cards: the switch is per club (groups on)', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  const giftDocs = () =>
    ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string; groupId?: string }>).filter((d) => d.kind === 'giftcard');

  beforeEach(() => {
    process.env[FLAG] = 'true';
    seedGroup('bpm');
    seedGroup('other');
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('a helper another club trusts cannot mint here, and sees no gifter surface', async () => {
    // The person-level switch is ON and the OTHER club granted it; BPM did not.
    const zach = seedMember('Zach', { canGift: true });
    seedMembership('other', zach.id, { name: 'Zach', canGift: true });
    seedMembership('bpm', zach.id, { name: 'Zach' });
    const asZachInBpm = { Cookie: `member_session=${memberCookieValue('Zach', zach.id)}` };

    const minted = await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500, note: 'Here' }, asZachInBpm));
    expect(minted.status).toBe(403);
    expect(giftDocs()).toHaveLength(0);

    const mine = await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZachInBpm))).json();
    expect(mine).toEqual({ canGift: false, cards: [] });
  });

  it('granted HERE, a helper mints here — and Member.canGift alone no longer counts for anything', async () => {
    const zach = seedMember('Zach'); // no person-level switch at all
    seedMembership('bpm', zach.id, { name: 'Zach', canGift: true });
    const asZach = { Cookie: `member_session=${memberCookieValue('Zach', zach.id)}` };

    const minted = await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500, note: 'Here' }, asZach));
    expect(minted.status).toBe(200);
    expect(giftDocs()).toEqual([expect.objectContaining({ groupId: 'bpm' })]);

    const mine = await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).json();
    expect(mine.canGift).toBe(true);
    expect(mine.cards.map((c: { note: string }) => c.note)).toEqual(['Here']);
  });

  it("PATCH /api/members writes the switch onto THIS club's membership, the roster shows it, and a stranger is a 404", async () => {
    seedMembership('bpm', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
    const zach = seedMember('Zach');
    seedMembership('bpm', zach.id, { name: 'Zach' });
    seedMembership('other', zach.id, { name: 'Zach' });

    const res = await membersPatch(makeAdminRequest('PATCH', `${BASE}/members`, { id: zach.id, canGift: true }));
    expect(res.status).toBe(200);
    expect((await readMembership('bpm', zach.id))?.canGift).toBe(true);
    // The OTHER club's membership is untouched: BPM's admin granted BPM's trust.
    expect((await readMembership('other', zach.id))?.canGift).toBeUndefined();
    // The roster sheet reads the club's value, so its checkbox cannot show another club's grant.
    const row = (await rosterMembers('bpm')).find((r) => r.member.id === zach.id);
    expect(row?.member.canGift).toBe(true);

    // Revoking goes the same way.
    const off = await membersPatch(makeAdminRequest('PATCH', `${BASE}/members`, { id: zach.id, canGift: false }));
    expect(off.status).toBe(200);
    expect((await readMembership('bpm', zach.id))?.canGift).toBe(false);

    // Someone on ANOTHER club's roster only: this club's admin can grant them nothing.
    const stranger = seedMember('Stranger');
    seedMembership('other', stranger.id, { name: 'Stranger' });
    const refused = await membersPatch(makeAdminRequest('PATCH', `${BASE}/members`, { id: stranger.id, canGift: true }));
    expect(refused.status).toBe(404);
    const doc = (getStore()['members'] as Array<{ id: string; canGift?: boolean }>).find((m) => m.id === stranger.id);
    expect(doc?.canGift).toBeUndefined();
    expect((await readMembership('other', stranger.id))?.canGift).toBeUndefined();
  });
});
