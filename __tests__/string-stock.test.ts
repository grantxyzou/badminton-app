import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { summarizeStringStock, validatePurchase, StringStockError, SET_M } from '@/lib/stringStock';
import { GET as stockGET, POST as stockPOST, DELETE as stockDELETE } from '@/app/api/stringing/stock/route';
import { GET as stringsGET, PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import type { CatalogItem, LedgerEntry, StringPurchase } from '@/lib/types';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { listGiftCards } from '@/lib/storeCredit';
import { resetMockStore, getStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember, memberCookieValue } from './helpers';

/**
 * String inventory (docs/plans/string-inventory.md): what the club bought,
 * what went onto rackets (counted from jobs, never logged), what it cost.
 */

const BASE = 'http://localhost:3000/api';
const bg65: CatalogItem = { id: 'string-yx-bg65', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 3], attributes: { gaugeMm: 0.7, setLengthM: 10, reelLengthM: 200 } } as CatalogItem;
const purchase = (over: Partial<StringPurchase>): StringPurchase => ({
  id: 'sp-0000000000000001', kind: 'stringPurchase', label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, date: '2026-09-01', createdAt: '2026-09-01T00:00:00Z', createdBy: 'a', ...over,
});
const job = (stringLabel: string, status: 'requested' | 'received' | 'strung' | 'ready' | 'picked_up') => ({ stringLabel, status, archivedAt: undefined });

describe('summarizeStringStock', () => {
  it('counts a set per job whose string has gone in, matched by label, and prices it at the latest reel', () => {
    const s = summarizeStringStock({
      offered: ['BG65', 'Exbolt 63'],
      links: { BG65: 'string-yx-bg65' },
      purchases: [purchase({}), purchase({ id: 'sp-0000000000000002', date: '2026-10-01', totalCostCents: 10000, createdAt: '2026-10-01T00:00:00Z' })],
      jobs: [job('bg65', 'picked_up'), job('BG65 ', 'strung'), job('BG65', 'requested'), job('Exbolt 63', 'ready'), job('Aerobite', 'ready')],
      catalog: new Map([[bg65.id, bg65]]),
    });
    const [bg, ex] = s.lines;
    expect(bg).toMatchObject({ label: 'BG65', catalogId: 'string-yx-bg65', setMetres: 10, purchasedMetres: 400, purchasedCostCents: 19000, purchases: 2, usedSets: 2, usedMetres: 20, remainingMetres: 380, remainingSets: 38 });
    // Latest reel: $100 / 200 m × 10 m = $5 a set.
    expect(bg.costPerSetCents).toBe(500);
    expect(bg.usedCostCents).toBe(1000);
    // Offered, used once, never bought: a line with no price and nothing left.
    expect(ex).toMatchObject({ label: 'Exbolt 63', catalogId: null, usedSets: 1, purchasedMetres: 0, remainingMetres: 0, costPerSetCents: null, usedCostCents: null });
    expect(s.unmatched).toEqual([{ label: 'Aerobite', usedSets: 1 }]);
    expect(s.totals).toEqual({ purchasedCostCents: 19000, usedSets: 3, usedCostCents: 1000, remainingValueCents: 19000 });
  });

  it('stock for a string no longer offered still shows, and remaining never goes below zero', () => {
    const s = summarizeStringStock({ offered: [], links: {}, purchases: [purchase({ label: 'Old string', unit: 'set', units: 2, metresPerUnit: SET_M, totalCostCents: 2000 })], jobs: [job('old string', 'strung'), job('old string', 'strung'), job('old string', 'strung')], catalog: new Map() });
    expect(s.lines[0]).toMatchObject({ label: 'Old string', purchasedMetres: 20, usedSets: 3, remainingMetres: 0, remainingSets: 0, costPerSetCents: 1000 });
  });

  it('validatePurchase refuses what it cannot count', () => {
    expect(() => validatePurchase({ label: '', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 100, date: '2026-10-10' })).toThrow(StringStockError);
    expect(() => validatePurchase({ label: 'BG65', unit: 'box', units: 1, metresPerUnit: 200, totalCostCents: 100, date: '2026-10-10' })).toThrow('invalid_units');
    expect(() => validatePurchase({ label: 'BG65', unit: 'reel', units: 1.5, metresPerUnit: 200, totalCostCents: 100, date: '2026-10-10' })).toThrow('invalid_units');
    expect(() => validatePurchase({ label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 0, totalCostCents: 100, date: '2026-10-10' })).toThrow('invalid_metres');
    expect(() => validatePurchase({ label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: -1, date: '2026-10-10' })).toThrow('invalid_cost');
    expect(() => validatePurchase({ label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 100, date: '10/10/2026' })).toThrow('invalid_date');
    expect(validatePurchase({ label: ' BG65 ', catalogId: 'string-yx-bg65', unit: 'set', units: 3, metresPerUnit: 10, totalCostCents: 3000, date: '2026-10-10', notes: 'Yumo' })).toEqual({ label: 'BG65', catalogId: 'string-yx-bg65', unit: 'set', units: 3, metresPerUnit: 10, totalCostCents: 3000, date: '2026-10-10', notes: 'Yumo' });
  });
});

describe('the stock routes', () => {
  beforeEach(async () => {
    resetMockStore();
    // The seed is memoised per process; the store was just wiped.
    __resetCatalogSeedForTests();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
    await seedTestAdminMember();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  });

  it('is admin-only, flag-gated, and a logged purchase shows in the summary, the ledger, and can be deleted', async () => {
    const lin = seedMember('Lin');
    expect((await stockGET(makeRequest('GET', `${BASE}/stringing/stock`, undefined, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }))).status).toBe(401);
    expect((await stockPOST(makeRequest('POST', `${BASE}/stringing/stock`, {}))).status).toBe(401);

    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG65'], links: { BG65: 'string-yx-bg65', Nope: 'string-yx-bg65' } }));
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, stringLabel: 'BG65', status: 'picked_up' });
    seedDoc('stringingJobs', { id: 'job-2', groupId: 'bpm', memberId: lin.id, stringLabel: 'BG65', status: 'requested' });

    const posted = await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG65', catalogId: 'string-yx-bg65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, date: '2026-10-01' }));
    expect(posted.status).toBe(201);
    const { purchase } = await posted.json();
    expect(purchase).toMatchObject({ kind: 'stringPurchase', label: 'BG65', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, groupId: 'bpm' });

    const summary = await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json();
    expect(summary.lines).toEqual([expect.objectContaining({ label: 'BG65', catalogId: 'string-yx-bg65', purchasedMetres: 200, usedSets: 1, remainingSets: 19, costPerSetCents: 450, usedCostCents: 450 })]);
    expect(summary.purchases).toHaveLength(1);
    // The ledger holds it as strings outlay, keyed on the purchase.
    const ledger = (getStore()['ledger'] ?? []) as LedgerEntry[];
    expect(ledger).toEqual([expect.objectContaining({ id: `strings:${purchase.id}`, kind: 'expense', account: 'club_outlay', amountCents: 9000, meta: expect.objectContaining({ category: 'strings' }) })]);

    // The purchase shares `clubSettings` with the gift cards and the offered
    // list; neither reader sees it (docs/plans/string-inventory.md, 2026-10-10).
    expect(await listGiftCards('bpm')).toEqual([]);
    expect((await (await stringsGET(makeAdminRequest('GET', `${BASE}/stringing/strings`))).json()).strings).toEqual(['BG65']);

    expect((await stockDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/stock?id=${purchase.id}`))).status).toBe(200);
    expect((await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json()).purchases).toEqual([]);
    expect(((getStore()['ledger'] ?? []) as LedgerEntry[]).some((e) => e.kind === 'void')).toBe(true);
    expect((await stockDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/stock?id=${purchase.id}`))).status).toBe(404);

    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'false';
    expect((await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).status).toBe(404);
  });

  it('a bad purchase is refused with its reason', async () => {
    const res = await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG65', unit: 'reel', units: 0, metresPerUnit: 200, totalCostCents: 9000, date: '2026-10-01' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_units' });
  });

  it('links ride beside the offered list: a link to a label not listed or an id the catalog lacks is dropped, and a list-only save keeps the links', async () => {
    const saved = await (await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG65', 'House string'], links: { BG65: 'string-yx-bg65', 'House string': 'string-nope', Ghost: 'string-yx-bg65' } }))).json();
    expect(saved).toEqual({ strings: ['BG65', 'House string'], links: { BG65: 'string-yx-bg65' } });
    const lin = seedMember('Lin');
    const read = await (await stringsGET(makeRequest('GET', `${BASE}/stringing/strings`, undefined, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }))).json();
    expect(read).toEqual({ strings: ['BG65', 'House string'], links: { BG65: 'string-yx-bg65' } });
    // An older client sends only the list: the link for the surviving label stays.
    const again = await (await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG65'] }))).json();
    expect(again).toEqual({ strings: ['BG65'], links: { BG65: 'string-yx-bg65' } });
  });
});
