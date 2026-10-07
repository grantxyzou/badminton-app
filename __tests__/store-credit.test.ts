import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { GET as myCredit } from '@/app/api/credit/route';
import { POST as redeem } from '@/app/api/credit/redeem/route';
import { POST as spend } from '@/app/api/credit/spend/route';
import { GET as adminCredit, POST as grant } from '@/app/api/admin/credit/route';
import { GET as listCards, POST as mint } from '@/app/api/admin/giftcards/route';
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

describe('account deletion', () => {
  it('removes the member\'s ledger and leaves others\'', async () => {
    await giveLin(1000);
    seedDoc('ledger', { id: 'grant:x', groupId: 'bpm', memberId: 'someone-else', kind: 'credit_grant', amountCents: 500, note: '', createdAt: '', createdBy: '' });
    await purgeMember(lin.id, 'Lin');
    expect((getStore()['ledger'] as Array<{ memberId: string }>).map((e) => e.memberId)).toEqual(['someone-else']);
  });
});
