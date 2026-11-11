import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as myCards, POST as mintAsMember } from '@/app/api/giftcards/route';
import { GET as adminCards, POST as mintAsAdmin } from '@/app/api/admin/giftcards/route';
import { PATCH as membersPatch } from '@/app/api/members/route';
import { mintGiftCard } from '@/lib/storeCredit';
import { readMembership } from '@/lib/groups';
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
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * GIFT CARDS ARE AN ORGANISER'S (Grant, 2026-11-10: "gift card should be
 * organizer feature only"; docs/plans/gift-card-ledger.md). Both ways to give
 * one — the console (`/api/admin/giftcards`) and Profile's "Give a gift card"
 * (`/api/giftcards`) — answer only for an organiser of the club the cookie
 * names, and the console's record of every card is theirs too. The `canGift`
 * switch that let an organiser hand minting to a helper is retired: nothing
 * reads it, and `PATCH /api/members` no longer writes it. Redeeming is every
 * member's, untouched. With groups off every admin is an organiser.
 */

const BASE = 'http://localhost:3000/api';
const giftDocs = () =>
  ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string; groupId?: string; note?: string; id: string }>).filter((d) => d.kind === 'giftcard');
const asMember = (name: string, id: string, groupId = 'bpm') => ({ Cookie: `member_session=${memberCookieValue(name, id, undefined, groupId)}` });
const mint = (headers: Record<string, string>, note = 'Here') =>
  mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500, note }, headers));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
});

describe('gift cards, groups off: an admin is the organiser', () => {
  it("an admin gives from Profile, and another club's cards never appear in BPM's lists", async () => {
    const asAdmin = asMember(getTestAdminName(), ADMIN_MEMBER_ID);
    await mintGiftCard('other', { amountCents: 700, note: 'Elsewhere', adminId: ADMIN_MEMBER_ID });

    expect((await mint(asAdmin)).status).toBe(200);
    const mine = await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asAdmin))).json();
    expect(mine.canGift).toBe(true);
    expect(mine.cards.map((c: { note: string }) => c.note)).toEqual(['Here']);

    const { cards } = await (await adminCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards.map((c: { note: string }) => c.note)).toEqual(['Here']);

    expect(giftDocs().find((d) => d.note === 'Here')).toMatchObject({ groupId: 'bpm' });
    expect(giftDocs().find((d) => d.note === 'Elsewhere')!.id.startsWith('other:')).toBe(true);
  });

  it('a member the old switch was ticked for gives nothing', async () => {
    const zach = seedMember('Zach', { canGift: true });
    const asZach = asMember('Zach', zach.id);
    const res = await mint(asZach);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'organiser_only' });
    expect(giftDocs()).toHaveLength(0);
    expect(await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).json()).toEqual({ canGift: false, cards: [] });
  });
});

describe('gift cards, groups on: only an organiser of THIS club', () => {
  const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
  beforeEach(() => {
    process.env[FLAG] = 'true';
    seedGroup('bpm');
    seedGroup('other');
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('an organiser gives from Profile and from the console, and reads the records', async () => {
    const asOrganiser = asMember(getTestAdminName(), ADMIN_MEMBER_ID);
    expect((await mint(asOrganiser, 'Profile')).status).toBe(200);
    const consoleMint = await mintAsAdmin(makeAdminRequest('POST', `${BASE}/admin/giftcards`, { amountCents: 500, note: 'Console' }));
    expect(consoleMint.status).toBe(200);

    const { cards } = await (await adminCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards.map((c: { note: string }) => c.note).sort()).toEqual(['Console', 'Profile']);
    expect(giftDocs().every((d) => d.groupId === 'bpm')).toBe(true);
  });

  it('an admin who is not an organiser is refused on every gift-card route, and nothing is minted', async () => {
    // The test admin, demoted from organiser to admin: the same cookies, a lower rank.
    const own = (getStore()['memberships'] as Array<{ id: string; role: string }>).find((m) => m.id === `bpm:${ADMIN_MEMBER_ID}`)!;
    own.role = 'admin';
    const asAdmin = asMember(getTestAdminName(), ADMIN_MEMBER_ID);

    expect((await mint(asAdmin)).status).toBe(403);
    expect(await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asAdmin))).json()).toEqual({ canGift: false, cards: [] });

    const read = await adminCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`));
    const write = await mintAsAdmin(makeAdminRequest('POST', `${BASE}/admin/giftcards`, { amountCents: 500, note: 'Nope' }));
    for (const res of [read, write]) {
      // A 401 would mean the fixture is not an admin at all, and the refusal would prove nothing.
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'organiser_only' });
    }
    expect(giftDocs()).toHaveLength(0);
  });

  it("the old switch counts for nothing, and an organiser of ANOTHER club is a member here", async () => {
    const zach = seedMember('Zach', { canGift: true });
    seedMembership('bpm', zach.id, { name: 'Zach', canGift: true });
    seedMembership('other', zach.id, { name: 'Zach', role: 'owner' });
    expect((await mint(asMember('Zach', zach.id, 'bpm'))).status).toBe(403);
    expect(giftDocs()).toHaveLength(0);
    // In the club he organises, he gives — stamped with that club.
    expect((await mint(asMember('Zach', zach.id, 'other'), 'Theirs')).status).toBe(200);
    expect(giftDocs()).toEqual([expect.objectContaining({ groupId: 'other', note: 'Theirs' })]);
  });

  it('PATCH /api/members no longer writes the switch', async () => {
    const zach = seedMember('Zach');
    seedMembership('bpm', zach.id, { name: 'Zach' });
    const res = await membersPatch(makeAdminRequest('PATCH', `${BASE}/members`, { id: zach.id, canGift: true }));
    expect(res.status).toBe(200);
    expect((await readMembership('bpm', zach.id))?.canGift).toBeUndefined();
    const doc = (getStore()['members'] as Array<{ id: string; canGift?: boolean }>).find((m) => m.id === zach.id);
    expect(doc?.canGift).toBeUndefined();
  });
});
