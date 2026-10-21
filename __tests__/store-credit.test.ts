import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { GET as myCredit } from '@/app/api/credit/route';
import { POST as redeem } from '@/app/api/credit/redeem/route';
import { POST as spend } from '@/app/api/credit/spend/route';
import { GET as adminCredit, POST as grant } from '@/app/api/admin/credit/route';
import { GET as listCards, POST as mint } from '@/app/api/admin/giftcards/route';
import { GET as myCards, POST as mintAsMember } from '@/app/api/giftcards/route';
import { PATCH as patchMember } from '@/app/api/members/route';
import { normalizeGiftCode, newGiftCode } from '@/lib/storeCredit';
import { purgeMember } from '@/lib/memberPurge';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * Store credit and gift cards (docs/plans/payments.md) through the real routes.
 * What matters most: money is never created or spent twice, a code is
 * single-use and says nothing to a guesser, and credit only ever pays a line
 * it covers in full.
 */

const BASE = 'http://localhost:3000/api';
const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

let lin: { id: string };
let row1: { id: string };
let row2: { id: string };
const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });
const row = (id: string) => (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;
const giveLin = (amountCents: number, note = 'Birthday') =>
  grant(makeAdminRequest('POST', `${BASE}/admin/credit`, { memberId: lin.id, amountCents, note }));
const balance = async () => (await (await myCredit(makeRequest('GET', `${BASE}/credit`, undefined, asLin()))).json()).balanceCents;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  row1 = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  row2 = seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
});

describe('gates', () => {
  it('everything 404s with the flag off', async () => {
    process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'false';
    expect((await myCredit(makeRequest('GET', `${BASE}/credit`, undefined, asLin()))).status).toBe(404);
    expect((await giveLin(1000)).status).toBe(404);
    expect((await mint(makeAdminRequest('POST', `${BASE}/admin/giftcards`, { amountCents: 1000 }))).status).toBe(404);
  });

  it('giving credit and minting cards are admin-only; reading and spending need a member', async () => {
    expect((await grant(makeRequest('POST', `${BASE}/admin/credit`, { memberId: lin.id, amountCents: 1000 }))).status).toBe(401);
    expect((await mint(makeRequest('POST', `${BASE}/admin/giftcards`, { amountCents: 1000 }))).status).toBe(401);
    expect((await adminCredit(makeRequest('GET', `${BASE}/admin/credit?memberId=${lin.id}`))).status).toBe(401);
    expect((await myCredit(makeRequest('GET', `${BASE}/credit`))).status).toBe(401);
    expect((await spend(makeRequest('POST', `${BASE}/credit/spend`, {}))).status).toBe(401);
  });
});

describe('giving credit', () => {
  it('adds up, and can be taken back but never below zero', async () => {
    expect((await giveLin(2000)).status).toBe(200);
    expect((await giveLin(500)).status).toBe(200);
    expect(await balance()).toBe(2500);
    expect((await giveLin(-1000, 'mistake')).status).toBe(200);
    expect(await balance()).toBe(1500);
    expect((await giveLin(-9999)).status).toBe(400);
    expect(await balance()).toBe(1500);
  });

  it('rejects zero, fractions and silly amounts', async () => {
    for (const a of [0, 12.5, 999_999]) expect((await giveLin(a)).status).toBe(400);
  });

  it('the admin sees the history, newest first', async () => {
    await giveLin(2000, 'Birthday');
    await giveLin(-500, 'Correction');
    const data = await (await adminCredit(makeAdminRequest('GET', `${BASE}/admin/credit?memberId=${lin.id}`))).json();
    expect(data.balanceCents).toBe(1500);
    expect(data.entries).toHaveLength(2);
  });

  it('the credit history lists credit only — a mirrored charge in the same partition stays out of it', async () => {
    // Review of #562: the Phase 2 mirror writes member_owed charges, payments
    // and voids into the member's partition; the balance was already credit-only
    // but the two listed histories were not.
    await giveLin(2000, 'Birthday');
    seedDoc('ledger', { id: `charge:${row1.id}:1`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 1200, note: 'Session 2026-09-24', ref: { kind: 'session', id: row1.id, pk: 'session-2026-09-24' }, createdAt: '2026-10-03T00:00:00Z', createdBy: 'system' });
    seedDoc('ledger', { id: `void:charge:${row1.id}:1`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'void', amountCents: -1200, note: 'Reversed: charge', ref: { kind: 'session', id: row1.id, pk: 'session-2026-09-24' }, createdAt: '2026-10-04T00:00:00Z', createdBy: 'system' });
    const mine = await (await myCredit(makeRequest('GET', `${BASE}/credit`, undefined, asLin()))).json();
    expect(mine.balanceCents).toBe(2000);
    expect(mine.entries.map((e: { kind: string }) => e.kind)).toEqual(['credit_grant']);
    const admin = await (await adminCredit(makeAdminRequest('GET', `${BASE}/admin/credit?memberId=${lin.id}`))).json();
    expect(admin.balanceCents).toBe(2000);
    expect(admin.entries.map((e: { kind: string }) => e.kind)).toEqual(['credit_grant']);
  });
});

describe('gift cards', () => {
  const mintOne = async (amountCents = 2500, note = 'Raffle') =>
    (await (await mint(makeAdminRequest('POST', `${BASE}/admin/giftcards`, { amountCents, note }))).json()) as { code: string };
  const redeemAs = (code: string, cookie = asLin()) => redeem(makeRequest('POST', `${BASE}/credit/redeem`, { code }, cookie));

  it('a minted code redeems once into the member\'s credit', async () => {
    const { code } = await mintOne();
    expect(code).toMatch(/^BPM-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const res = await redeemAs(code);
    expect(await res.json()).toEqual({ ok: true, amountCents: 2500 });
    expect(await balance()).toBe(2500);
  });

  it('a second redemption — even by someone else — gets nothing, and looks like a wrong code', async () => {
    const { code } = await mintOne();
    await redeemAs(code);
    const viktor = seedMember('Viktor');
    const again = await redeemAs(code, { Cookie: `member_session=${memberCookieValue('Viktor', viktor.id)}` });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'gift_not_found' });
    expect(await (await redeemAs('BPM-AAAA-AAAA')).json()).toEqual({ error: 'gift_not_found' });
  });

  it('a double tap credits once (the ledger id is the card)', async () => {
    const { code } = await mintOne();
    await Promise.all([redeemAs(code), redeemAs(code)]);
    expect(await balance()).toBe(2500);
  });

  it('the claim is a doc partitioned by its own id — unique across members, not only within one', async () => {
    // Cosmos enforces id uniqueness per PARTITION; the ledger is per member.
    // The mock ignores partitions, so assert the shape that makes it safe.
    const { code } = await mintOne();
    await redeemAs(code);
    const claims = (getStore()['clubSettings'] as Array<{ id: string; kind?: string }>).filter((d) => d.kind === 'giftclaim');
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toMatch(/^giftcard:[0-9a-f]{64}:claim$/);
    expect(JSON.stringify(claims[0])).not.toContain(lin.id);
  });

  it('forgives case, spaces and dashes when typed', async () => {
    const { code } = await mintOne(1000);
    expect((await redeemAs(code.toLowerCase().replace(/-/g, ' '))).status).toBe(200);
  });

  it('the code is never stored or listed — only its last four', async () => {
    const { code } = await mintOne();
    expect(JSON.stringify(getStore()['clubSettings'])).not.toContain(code);
    const { cards } = await (await listCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards).toEqual([expect.objectContaining({ amountCents: 2500, note: 'Raffle', hint: code.slice(-4), redeemedAt: null })]);
    expect(JSON.stringify(cards)).not.toContain(code);
  });

  it("the admin's record names who redeemed it, when, and how much of it has gone where (docs/plans/gift-card-ledger.md)", async () => {
    const { code } = await mintOne(2500, 'Raffle');
    await redeemAs(code);
    const stored = (getStore()['clubSettings'] as Array<{ kind?: string; redeemedBy?: string }>).find((d) => d.kind === 'giftcard')!;
    expect(stored.redeemedBy).toBe(lin.id);
    // $12 of it pays the oldest owed line; $13 is left ON THIS CARD.
    await spend(makeRequest('POST', `${BASE}/credit/spend`, {}, asLin()));
    const { cards } = await (await listCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      amountCents: 2500, note: 'Raffle', hint: code.slice(-4),
      createdBy: { name: expect.any(String) },
      redeemedBy: { memberId: lin.id, name: 'Lin' },
      usedCents: 1200, remainingCents: 1300,
    });
    expect(cards[0].redeemedAt).toEqual(expect.any(String));
    expect(cards[0].uses).toEqual([expect.objectContaining({ amountCents: 1200, note: 'Session 2026-09-24', reversed: false })]);
    expect(JSON.stringify(cards)).not.toContain(code);
  });

  it("a spend that bounced in the same millisecond as its refund leaves the admin's record unused", async () => {
    // payWithCredit writes the spend and its refund within one request. The
    // reading sorts by createdAt, and `refund:` < `spend:` by id, so without a
    // kind tie-break the refund ran first and the card read as used.
    const { code } = await mintOne(3000, 'Raffle');
    await redeemAs(code);
    const at = new Date(Date.now() + 60_000).toISOString(); // after the redemption, which is stamped now
    for (const [id, kind, amountCents] of [[`spend:${row1.id}:0`, 'credit_spend', -2000], [`refund:${row1.id}:0`, 'credit_refund', 2000]] as const) {
      seedDoc('ledger', { id, groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind, amountCents, note: '', createdAt: at, createdBy: lin.id, ref: { kind: 'session', id: row1.id, pk: 'session-2026-09-24' } });
    }
    const { cards } = await (await listCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ usedCents: 0, remainingCents: 3000 });
    expect(cards[0].uses).toEqual([expect.objectContaining({ amountCents: 2000, reversed: true })]);
    expect(await balance()).toBe(3000);
  });

  it('an older card with no redeemedBy is still attributed through its ledger entry', async () => {
    const { code } = await mintOne(1000);
    await redeemAs(code);
    const store = getStore()['clubSettings'] as Array<Record<string, unknown>>;
    const stored = store.find((d) => d.kind === 'giftcard')!;
    delete stored.redeemedBy; // what a card redeemed before 2026-10-09 looks like
    const { cards } = await (await listCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards[0]).toMatchObject({ redeemedBy: { memberId: lin.id, name: 'Lin' }, usedCents: 0, remainingCents: 1000 });
  });

  it('a member may give out cards only once an admin ticks canGift, and their list shows redeemed-or-not, never who', async () => {
    const zach = seedMember('Zach');
    const asZach = { Cookie: `member_session=${memberCookieValue('Zach', zach.id)}` };
    // Not a gifter: the row is hidden and a mint is refused.
    expect(await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).json()).toEqual({ canGift: false, cards: [] });
    expect((await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500 }, asZach))).status).toBe(403);
    // The roster switch, re-read fresh on every call — no new cookie needed.
    expect((await patchMember(makeAdminRequest('PATCH', `${BASE}/members`, { id: zach.id, canGift: true }))).status).toBe(200);
    const minted = await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500, note: 'Thanks' }, asZach));
    expect(minted.status).toBe(200);
    const { code } = (await minted.json()) as { code: string };
    expect(code).toMatch(/^BPM-/);
    await redeemAs(code);
    const mine = await (await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).json();
    expect(mine.canGift).toBe(true);
    expect(mine.cards).toEqual([expect.objectContaining({ amountCents: 500, note: 'Thanks', redeemedAt: expect.any(String) })]);
    expect(JSON.stringify(mine)).not.toContain(lin.id);
    expect(JSON.stringify(mine)).not.toContain(code);
    // The admin's record says who made it.
    const { cards } = await (await listCards(makeAdminRequest('GET', `${BASE}/admin/giftcards`))).json();
    expect(cards[0].createdBy).toEqual({ memberId: zach.id, name: 'Zach' });
    // Taking the switch away takes the ability with it, at once.
    await patchMember(makeAdminRequest('PATCH', `${BASE}/members`, { id: zach.id, canGift: false }));
    expect((await mintAsMember(makeRequest('POST', `${BASE}/giftcards`, { amountCents: 500 }, asZach))).status).toBe(403);
    // Signed out, or the flag off: nothing.
    expect((await myCards(makeRequest('GET', `${BASE}/giftcards`))).status).toBe(401);
    process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'false';
    expect((await myCards(makeRequest('GET', `${BASE}/giftcards`, undefined, asZach))).status).toBe(404);
  });

  it('normalizeGiftCode / newGiftCode', () => {
    expect(normalizeGiftCode('bpm 7k2q x9fa')).toBe('BPM-7K2Q-X9FA');
    expect(normalizeGiftCode('7K2QX9FA')).toBe('BPM-7K2Q-X9FA');
    expect(normalizeGiftCode('BPM-7K2Q')).toBe('');
    for (let i = 0; i < 50; i++) expect(newGiftCode()).not.toMatch(/[01OIL]/);
  });
});

describe('Pay with credit', () => {
  const pay = () => spend(makeRequest('POST', `${BASE}/credit/spend`, {}, asLin()));

  it('pays the oldest lines the credit covers IN FULL, and nothing partly', async () => {
    await giveLin(2000); // covers $12, not then $15
    expect(await (await pay()).json()).toEqual({ ok: true, paid: 1, spentCents: 1200, balanceCents: 800 });
    expect(row(row1.id)).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(row(row2.id).paid).toBe(false);
    expect(await balance()).toBe(800);
  });

  it('skips a line it cannot cover to pay a later one it can', async () => {
    row(row1.id).owedAmount = 30;
    await giveLin(1500);
    expect(await (await pay()).json()).toMatchObject({ paid: 1, spentCents: 1500 });
    expect(row(row2.id).paid).toBe(true);
  });

  it('a double tap pays each line once', async () => {
    await giveLin(5000);
    await Promise.all([pay(), pay()]);
    expect(await balance()).toBe(5000 - 2700);
  });

  it('two taps at once never take the balance below zero', async () => {
    await giveLin(2000); // $12 and $15 owed: either fits, not both
    await Promise.all([pay(), pay(), pay()]);
    const left = await balance();
    expect(left).toBeGreaterThanOrEqual(0);
    const paidRows = [row(row1.id), row(row2.id)].filter((r) => r.paid === true);
    const paidCents = paidRows.reduce((sum, r) => sum + Math.round(Number(r.owedAmount) * 100), 0);
    expect(paidCents).toBe(2000 - left);
  });

  it("never pays an unsettled session's live estimate", async () => {
    seedSession('session-2026-10-05', { datetime: '2026-10-05T19:00:00-04:00', costPerCourt: 20, courts: 1 });
    const live = seedPlayer('session-2026-10-05', 'Lin', { memberId: lin.id });
    row(row1.id).paid = true;
    row(row2.id).paid = true;
    await giveLin(5000);
    // Only the estimate is left: nothing frozen to pay.
    expect((await pay()).status).toBe(409);
    expect(row(live.id).paid).toBe(false);
    expect(await balance()).toBe(5000);
  });

  it('nothing owed or no credit → 409, nothing moves', async () => {
    expect((await pay()).status).toBe(409);
    await giveLin(1000);
    row(row1.id).paid = true;
    row(row2.id).paid = true;
    expect((await pay()).status).toBe(409);
    expect(await balance()).toBe(1000);
  });
});

describe('failure recovery (review of #544)', () => {
  const pay = () => spend(makeRequest('POST', `${BASE}/credit/spend`, {}, asLin()));
  const entry = (id: string, kind: string, amountCents: number, ref?: string) =>
    seedDoc('ledger', {
      id, groupId: 'bpm', memberId: lin.id, kind, amountCents, note: '', createdAt: '2026-10-05T00:00:00Z', createdBy: lin.id,
      ...(ref ? { ref: { kind: 'session', id: ref, pk: 'session-2026-09-24' } } : {}),
    });

  it('a spend whose row update never happened (process died) is FINISHED, not skipped', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, row1.id);
    const res = await (await pay()).json();
    expect(row(row1.id)).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(res.balanceCents).toBe(800); // debited once, not twice
  });

  it('a line whose earlier spend was refunded can be paid with credit again', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, row1.id);
    entry(`refund:${row1.id}:0`, 'credit_refund', 1200, row1.id);
    expect(await (await pay()).json()).toMatchObject({ paid: 1, spentCents: 1200, balanceCents: 800 });
    expect(row(row1.id).paid).toBe(true);
    expect((getStore()['ledger'] as Array<{ id: string }>).map((e) => e.id)).toContain(`spend:${row1.id}:1`);
  });

  it('a database error while marking the row paid gives the credit back', async () => {
    await giveLin(2000);
    const real = cosmos.getContainer;
    const spy = vi.spyOn(cosmos, 'getContainer').mockImplementation(((name: string) => {
      const c = real(name as never);
      if (name !== 'players') return c;
      return { ...c, item: (id: string, pk: string) => ({ ...c.item(id, pk), read: c.item(id, pk).read.bind(c.item(id, pk)), replace: async () => { throw Object.assign(new Error('boom'), { code: 503 }); } }), items: c.items } as never;
    }) as never);
    try {
      expect((await pay()).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(row(row1.id).paid).toBe(false);
    expect(await balance()).toBe(2000);
    // …and a retry pays it.
    expect(await (await pay()).json()).toMatchObject({ paid: 1, spentCents: 1200 });
  });

  it('an unfinished spend is finished even when the balance left is below zero', async () => {
    entry('grant:a', 'credit_grant', 1500);
    entry(`spend:${row2.id}:0`, 'credit_spend', -1500, row2.id);
    (getStore()['ledger'] as Array<Record<string, unknown>>).find((e) => e.id === `spend:${row2.id}:0`)!.ref = { kind: 'session', id: row2.id, pk: 'session-2026-10-01' };
    expect(await (await pay()).json()).toMatchObject({ paid: 1, balanceCents: 0 });
    expect(row(row2.id).paid).toBe(true);
  });

  it('a FRESH spend from another request is left alone (no double-tap rescue race)', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, row1.id);
    (getStore()['ledger'] as Array<Record<string, unknown>>).find((e) => e.id === `spend:${row1.id}:0`)!.createdAt = new Date().toISOString();
    await pay().catch(() => undefined);
    expect(row(row1.id).paid).toBe(false); // the other request owns it
    expect((getStore()['ledger'] as Array<{ id: string }>).some((e) => e.id.startsWith(`refund:${row1.id}`))).toBe(false);
  });

  it('a gift claim is released if crediting fails, so the card still works', async () => {
    const { code } = (await (await mint(makeAdminRequest('POST', `${BASE}/admin/giftcards`, { amountCents: 1000 }))).json()) as { code: string };
    const real = cosmos.getContainer;
    const spy = vi.spyOn(cosmos, 'getContainer').mockImplementation(((name: string) => {
      const c = real(name as never);
      if (name !== 'ledger') return c;
      return { ...c, items: { ...c.items, create: async () => { throw Object.assign(new Error('boom'), { code: 503 }); } } } as never;
    }) as never);
    try {
      expect((await redeem(makeRequest('POST', `${BASE}/credit/redeem`, { code }, asLin()))).status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect((await redeem(makeRequest('POST', `${BASE}/credit/redeem`, { code }, asLin()))).status).toBe(200);
    expect(await balance()).toBe(1000);
  });

  it('gift codes draw every character evenly enough (no modulo bias by construction)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const ch of newGiftCode().slice(4).replace('-', '')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(31);
  });
});

describe('a stale spend is reconciled against the ROW, whatever happened to it', () => {
  // A spend is written BEFORE its row is marked paid. If the process died
  // between the two and the row was then paid some other way, the old
  // recovery never saw it: it walked the OWED lines, and a paid row is not
  // one. The credit stayed taken forever.
  const pay = () => spend(makeRequest('POST', `${BASE}/credit/spend`, {}, asLin()));
  const ledgerIds = () => (getStore()['ledger'] as Array<{ id: string }>).map((e) => e.id);
  const entry = (id: string, kind: string, amountCents: number, ref?: { kind: 'session' | 'stringing'; id: string; pk: string }, createdAt = '2026-10-05T00:00:00Z') =>
    seedDoc('ledger', { id, groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind, amountCents, note: '', ...(ref ? { ref } : {}), createdAt, createdBy: lin.id });
  const sessionRef = (id: string, pk: string) => ({ kind: 'session' as const, id, pk });

  it('paid manually since → refunded by the next "Pay with credit", even with nothing else owed', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    Object.assign(row(row1.id), { paid: true, paidVia: 'manual' });
    Object.assign(row(row2.id), { paid: true, paidVia: 'manual' });
    // Nothing is owed, so the tap still answers 409 — but the refund landed first.
    const res = await pay();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'nothing_to_pay' });
    expect(ledgerIds()).toContain(`refund:${row1.id}:0`);
    expect(await balance()).toBe(2000);
    // And a second look writes nothing more.
    await pay();
    expect(ledgerIds().filter((id) => id.startsWith('refund:'))).toHaveLength(1);
  });

  it('paid manually since → refunded by the balance read alone', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    Object.assign(row(row1.id), { paid: true, paidVia: 'etransfer' });
    expect(await balance()).toBe(2000);
    const refund = (getStore()['ledger'] as Array<Record<string, unknown>>).find((e) => e.id === `refund:${row1.id}:0`);
    expect(refund).toMatchObject({ kind: 'credit_refund', amountCents: 1200, note: 'Paid another way — credit returned' });
    expect(row(row1.id).paidVia).toBe('etransfer'); // the row is not touched
  });

  it('a FRESH spend is left alone, whatever the row says', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'), new Date().toISOString());
    Object.assign(row(row1.id), { paid: true, paidVia: 'manual' });
    expect(await balance()).toBe(800);
    expect(ledgerIds().some((id) => id.startsWith('refund:'))).toBe(false);
  });

  it('still unpaid → the row update is finished (paid by credit), from the balance read too', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    expect(await balance()).toBe(800);
    expect(row(row1.id)).toMatchObject({ paid: true, paidVia: 'credit', paidAt: '2026-10-05T00:00:00Z' });
    expect(ledgerIds().some((id) => id.startsWith('refund:'))).toBe(false);
    // A spend that completed is the common case, and it nets negative too: never refunded.
    expect(await balance()).toBe(800);
  });

  it('covered or removed since → refunded', async () => {
    entry('grant:a', 'credit_grant', 3000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    entry(`spend:${row2.id}:0`, 'credit_spend', -1500, sessionRef(row2.id, 'session-2026-10-01'));
    Object.assign(row(row1.id), { writtenOff: true, coverMode: 'absorb' });
    Object.assign(row(row2.id), { removed: true });
    expect(await balance()).toBe(3000);
    expect(ledgerIds()).toEqual(expect.arrayContaining([`refund:${row1.id}:0`, `refund:${row2.id}:0`]));
  });

  // Counts point reads of the row containers, the way the mirror-failure tests spy.
  const spyRowReads = () => {
    const reads: string[] = [];
    const real = cosmos.getContainer;
    const spy = vi.spyOn(cosmos, 'getContainer').mockImplementation(((name: string) => {
      const c = real(name as never);
      if (name !== 'players' && name !== 'stringingJobs') return c;
      return {
        ...c,
        items: c.items,
        item: (id: string, pk: string) => {
          const it = c.item(id, pk);
          return { ...it, read: async () => { reads.push(`${name}:${id}`); return it.read(); } };
        },
      } as never;
    }) as never);
    return { reads, restore: () => spy.mockRestore() };
  };

  it('completed credit payments cost the balance read NO row reads — the mirror entry answers for them', async () => {
    // Every credit payment ever made nets negative on its ref forever; reading
    // each row on every balance look would grow with the member's history.
    process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
    try {
      await giveLin(6000);
      expect(await (await pay()).json()).toMatchObject({ paid: 2, spentCents: 2700 });
      // A stringing line paid with credit, as the mirror leaves it.
      entry('spend:J-0001:0', 'credit_spend', -3000, { kind: 'stringing', id: 'J-0001', pk: lin.id });
      seedDoc('ledger', { id: 'payment:J-0001:1759622400000', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'payment', amountCents: -3000, note: 'Paid with credit', ref: { kind: 'stringing', id: 'J-0001', pk: lin.id }, meta: { via: 'credit' }, createdAt: '2026-10-05T00:00:00Z', createdBy: 'system' });
      // Age the spends past the fresh window.
      for (const e of getStore()['ledger'] as Array<Record<string, unknown>>) if (String(e.id).startsWith('spend:')) e.createdAt = '2026-10-05T00:00:00Z';
      const before = ledgerIds().length;
      const { reads, restore } = spyRowReads();
      try {
        expect(await balance()).toBe(300);
      } finally {
        restore();
      }
      expect(reads).toEqual([]);
      expect(ledgerIds()).toHaveLength(before);
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    }
  });

  it('with no mirror entry the row IS read — and, paid by credit, left alone', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    Object.assign(row(row1.id), { paid: true, paidVia: 'credit', paidAt: '2026-10-05T00:00:00Z' });
    const { reads, restore } = spyRowReads();
    try {
      expect(await balance()).toBe(800);
    } finally {
      restore();
    }
    expect(reads).toEqual([`players:${row1.id}`]);
    expect(ledgerIds().some((id) => id.startsWith('refund:'))).toBe(false);
  });

  it('a credit payment since VOIDED (the row un-ticked) is not "completed": the row is read again', async () => {
    entry('grant:a', 'credit_grant', 2000);
    entry(`spend:${row1.id}:0`, 'credit_spend', -1200, sessionRef(row1.id, 'session-2026-09-24'));
    seedDoc('ledger', { id: `payment:${row1.id}:1759622400000`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'payment', amountCents: -1200, note: 'Paid with credit', ref: sessionRef(row1.id, 'session-2026-09-24'), meta: { via: 'credit' }, createdAt: '2026-10-05T00:00:00Z', createdBy: 'system' });
    seedDoc('ledger', { id: `void:payment:${row1.id}:1759622400000`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'void', amountCents: 1200, note: 'Reversed', ref: sessionRef(row1.id, 'session-2026-09-24'), createdAt: '2026-10-06T00:00:00Z', createdBy: 'system' });
    Object.assign(row(row1.id), { paid: true, paidVia: 'manual' });
    const { reads, restore } = spyRowReads();
    try {
      expect(await balance()).toBe(2000);
    } finally {
      restore();
    }
    expect(reads).toEqual([`players:${row1.id}`]);
    expect(ledgerIds()).toContain(`refund:${row1.id}:0`);
  });

  it('a stringing job is credit\'s when its paidAt IS the spend\'s time; any other paidAt is another route', async () => {
    const job = (id: string, paidAt: string | null) =>
      seedDoc('stringingJobs', { id, groupId: 'bpm', memberId: lin.id, memberName: 'Lin', status: 'ready', priceCents: 3000, paidAt, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z', history: [] });
    entry('grant:a', 'credit_grant', 6000);
    job('J-0001', '2026-10-05T00:00:00Z'); // paid by the spend below: same instant
    entry('spend:J-0001:0', 'credit_spend', -3000, { kind: 'stringing', id: 'J-0001', pk: lin.id });
    job('J-0002', '2026-10-06T12:00:00Z'); // the stringer ticked it paid after the spend died
    entry('spend:J-0002:0', 'credit_spend', -3000, { kind: 'stringing', id: 'J-0002', pk: lin.id });
    expect(await balance()).toBe(3000);
    expect(ledgerIds().filter((id) => id.startsWith('refund:'))).toEqual(['refund:J-0002:0']);
  });
});

describe('account deletion', () => {
  it('removes the member\'s ledger and leaves others\'', async () => {
    await giveLin(1000);
    seedDoc('ledger', { id: 'grant:x', groupId: 'bpm', memberId: 'someone-else', kind: 'credit_grant', amountCents: 500, note: '', createdAt: '', createdBy: '' });
    await purgeMember(lin.id, 'Lin');
    expect((getStore()['ledger'] as Array<{ memberId: string }>).map((e) => e.memberId)).toEqual(['someone-else']);
  });
});
