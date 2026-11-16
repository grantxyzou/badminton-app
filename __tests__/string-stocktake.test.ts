import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { POST as jobsPOST } from '@/app/api/stringing/jobs/route';
import { PATCH as jobPATCH } from '@/app/api/stringing/jobs/[id]/route';
import { GET as countGET, POST as countPOST } from '@/app/api/stringing/stocktake/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { summarizeStringStock } from '@/lib/stringStock';
import {
  gramsPerMetre, metresByWeight, setsByEye, setsByWeight, lastWeighIn, DEFAULT_GRAMS_PER_METRE, type StringCount,
} from '@/lib/stringStocktakeMath';
import type { StringPurchase } from '@/lib/types';
import type { ReelColourId } from '@/lib/stringPalette';
import { resetMockStore, getStore, seedMember, makeRequest, makeAdminRequest, memberCookieValue, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The stocktake (docs/plans/string-photo-stocktake.md; Grant, 2026-11-15:
 * part reels "fullness by eye and weigh it", counted by "Admins and
 * stringers"). Scanning replaced the photo (docs/plans/string-barcode-stocktake.md);
 * a count saved from a photo before then still reads as one.
 */

// ── The arithmetic ─────────────────────────────────────────────────────────

describe('counting a reel', () => {
  it('by eye: its share of a full reel, in whole sets', () => {
    expect(setsByEye('full', 200, 10)).toBe(20);
    expect(setsByEye('three_quarters', 200, 10)).toBe(15);
    expect(setsByEye('quarter', 200, 10)).toBe(5);
  });

  it('by weight: (scale − empty reel) ÷ grams a metre, a part set left on the reel is not a set', () => {
    expect(metresByWeight(121, 70, 0.41)).toBeCloseTo(124.39, 1);
    expect(setsByWeight(121, 70, 0.41, 10)).toBe(12);
    expect(setsByWeight(60, 70, 0.41, 10)).toBe(0); // a reading under the empty reel is none, never negative
  });

  it('grams a metre come from the gauge, or a sensible default', () => {
    expect(gramsPerMetre(0.68)).toBeCloseTo(0.414, 2);
    expect(gramsPerMetre(null)).toBe(DEFAULT_GRAMS_PER_METRE);
    expect(gramsPerMetre(9)).toBe(DEFAULT_GRAMS_PER_METRE);
  });

  it('the next weigh-in starts from the last one’s empty-reel weight', () => {
    const counts: StringCount[] = [
      { id: 'sc-1', kind: 'stringCount', countedAt: '2026-10-01T00:00:00Z', countedBy: 'a', source: 'hand', lines: [{ label: 'BG80', sets: 10, appSets: 9, reels: [{ by: 'weigh', grams: 100, tareGrams: 66, gramsPerMetre: 0.4 }] }] },
      { id: 'sc-2', kind: 'stringCount', countedAt: '2026-11-01T00:00:00Z', countedBy: 'a', source: 'hand', lines: [{ label: 'bg80', sets: 8, appSets: 9, reels: [{ by: 'weigh', grams: 90, tareGrams: 70, gramsPerMetre: 0.41 }] }] },
    ];
    expect(lastWeighIn(counts, 'BG80')).toEqual({ tareGrams: 70, gramsPerMetre: 0.41 });
    expect(lastWeighIn(counts, 'BG65')).toBeNull();
  });
});

describe('a count resets the shelf', () => {
  const reel = (o: Partial<StringPurchase> = {}): StringPurchase => ({
    id: 'sp-0000000000000001', kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200,
    totalCostCents: 20000, date: '2026-09-01', createdAt: '2026-09-01T00:00:00Z', createdBy: 'a', ...o,
  });
  const job = (strungAt: string) => ({ stringLabel: 'BG80', status: 'picked_up' as const, strungAt });
  const count = (at: string, sets: number, color?: ReelColourId): StringCount => ({
    id: `sc-${at}`, kind: 'stringCount', countedAt: at, countedBy: 'a', source: 'photo',
    lines: [{ label: 'BG80', sets, appSets: 0, ...(color ? { color } : {}) }],
  });
  const line = (purchases: StringPurchase[], jobs: ReturnType<typeof job>[], counts: StringCount[]) =>
    summarizeStringStock({ offered: ['BG80'], links: {}, purchases, jobs, catalog: new Map(), counts }).lines[0];

  it('the count wins over the arithmetic; only later jobs and purchases move it', () => {
    // App: 200 m − 5 sets = 15. Counted 12 on Oct 15. Then 2 more strung, one reel bought.
    const l = line(
      [reel(), reel({ id: 'sp-0000000000000002', createdAt: '2026-10-20T00:00:00Z', date: '2026-10-20' })],
      [...Array.from({ length: 5 }, () => job('2026-10-01T00:00:00Z')), job('2026-10-16T00:00:00Z'), job('2026-10-17T00:00:00Z')],
      [count('2026-10-15T00:00:00Z', 12)],
    );
    expect(l.remainingSets).toBe(12 - 2 + 20);
    expect(l.usedSets).toBe(7); // history is kept
    expect(l.lastCount).toEqual({ at: '2026-10-15T00:00:00Z', sets: 12, source: 'photo' });
  });

  it('the latest count of a string replaces an earlier one outright', () => {
    const l = line([reel()], [], [count('2026-10-01T00:00:00Z', 5), count('2026-11-01T00:00:00Z', 9)]);
    expect(l.remainingSets).toBe(9);
  });

  it('a string counted but never bought logged is known stock, not "no stock"', () => {
    const l = line([], [], [count('2026-10-01T00:00:00Z', 4)]);
    expect(l.remainingSets).toBe(4);
    expect(l.lastCount?.sets).toBe(4);
  });

  it('a colour counted goes to that colour’s pool', () => {
    const l = line([reel()], [], [count('2026-10-01T00:00:00Z', 6, 'white')]);
    expect(l.byColour).toEqual([expect.objectContaining({ color: 'white', remainingSets: 6 })]);
  });
});

// ── Through the routes ──────────────────────────────────────────────────────

const BASE = 'http://localhost:3000/api';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('the stocktake routes', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    resetShelfCache();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80', 'Exbolt 63'] }));
    await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-11-01' }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  const asMember = (name: string, id: string) => ({ Cookie: `member_session=${memberCookieValue(name, id)}` });

  it('an admin and a stringer may read the sheet; a player may not; no money in it', async () => {
    const zach = seedMember('Zach', { canString: true });
    const lin = seedMember('Lin');
    const admin = await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`));
    expect(admin.status).toBe(200);
    const body = await admin.json();
    expect(body.strings.map((s: { label: string }) => s.label)).toEqual(['BG80', 'Exbolt 63']);
    expect(body.strings[0]).toMatchObject({ appSets: 20, setMetres: 10, reelMetres: 200, tareGrams: null, lastCount: null });
    expect(body.barcodes).toEqual([]);
    expect(body).not.toHaveProperty('photo');
    expect(JSON.stringify(body)).not.toMatch(/Cents|price|cost/i);
    expect((await countGET(makeRequest('GET', `${BASE}/stringing/stocktake`, undefined, asMember('Zach', zach.id)))).status).toBe(200);
    expect((await countGET(makeRequest('GET', `${BASE}/stringing/stocktake`, undefined, asMember('Lin', lin.id)))).status).toBe(401);
    expect((await countGET(makeRequest('GET', `${BASE}/stringing/stocktake`))).status).toBe(401);
  });

  it('saving re-adds every line on the server, and the shelf starts from the count', async () => {
    const zach = seedMember('Zach', { canString: true });
    const res = await countPOST(makeRequest('POST', `${BASE}/stringing/stocktake`, {
      source: 'scan',
      lines: [
        // The client claims 999; the server works it out: ¾ of a 200 m reel + 2 packets = 17.
        { label: 'bg80', packets: 2, reels: [{ by: 'eye', fullness: 'three_quarters' }], sets: 999 },
        { label: 'Exbolt 63', packets: 0, reels: [{ by: 'weigh', grams: 121, tareGrams: 70, gramsPerMetre: 0.41 }] },
      ],
    }, asMember('Zach', zach.id)));
    expect(res.status).toBe(201);
    expect((await res.json()).lines).toEqual([
      { label: 'BG80', appSets: 20, counted: 17 },
      { label: 'Exbolt 63', appSets: 0, counted: 12 },
    ]);
    const saved = (getStore()['clubSettings'] as Array<{ kind?: string; countedBy?: string; groupId?: string }>).find((r) => r.kind === 'stringCount');
    expect(saved).toMatchObject({ countedBy: zach.id, groupId: 'bpm' });

    // A job strung after the count takes a set off the counted figure.
    const lin = seedMember('Lin');
    const created = await jobsPOST(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
      memberId: lin.id, memberName: 'Lin', racketLabel: 'Astrox 88D', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
    }));
    const { job } = await created.json();
    await new Promise((r) => setTimeout(r, 5));
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, status: 'strung' }), ctx(job.id))).status).toBe(200);
    const stock = await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json();
    const bg80 = stock.lines.find((l: { label: string }) => l.label === 'BG80');
    expect(bg80.remainingSets).toBe(16);
    expect(bg80.lastCount).toMatchObject({ sets: 17, source: 'scan' });
    const ex = stock.lines.find((l: { label: string }) => l.label === 'Exbolt 63');
    expect(ex.remainingSets).toBe(12);

    // The next weigh-in starts from this one's empty reel.
    const sheet = await (await countGET(makeAdminRequest('GET', `${BASE}/stringing/stocktake`))).json();
    expect(sheet.strings.find((s: { label: string }) => s.label === 'Exbolt 63')).toMatchObject({ tareGrams: 70, gramsPerMetre: 0.41 });
  });

  it('refuses a string not on the shelf, a bad reel, and a player', async () => {
    const lin = seedMember('Lin');
    const post = (body: Record<string, unknown>, headers?: Record<string, string>) =>
      headers ? countPOST(makeRequest('POST', `${BASE}/stringing/stocktake`, body, headers)) : countPOST(makeAdminRequest('POST', `${BASE}/stringing/stocktake`, body));
    expect((await post({ source: 'hand', lines: [{ label: 'Nope', packets: 1 }] })).status).toBe(400);
    expect((await post({ source: 'hand', lines: [{ label: 'BG80', reels: [{ by: 'eye', fullness: 'mostly' }] }] })).status).toBe(400);
    expect((await post({ source: 'hand', lines: [{ label: 'BG80', packets: -1 }] })).status).toBe(400);
    expect((await post({ source: 'hand', lines: [] })).status).toBe(400);
    // The photo is gone: a client still sending it is refused, never stored as one.
    expect((await post({ source: 'photo', lines: [{ label: 'BG80', packets: 1 }] })).status).toBe(400);
    expect((await post({ source: 'hand', lines: [{ label: 'BG80', packets: 1 }] }, asMember('Lin', lin.id))).status).toBe(401);
  });
});
