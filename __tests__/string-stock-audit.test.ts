import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { PATCH as shopPATCH } from '@/app/api/stringing/shop/route';
import { POST as jobsPOST } from '@/app/api/stringing/jobs/route';
import { POST as requestPOST } from '@/app/api/stringing/requests/route';
import { PATCH as jobPATCH, DELETE as jobDELETE } from '@/app/api/stringing/jobs/[id]/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { summarizeStringStock, usesASet } from '@/lib/stringStock';
import type { StringPurchase, StringingJob } from '@/lib/types';
import {
  resetMockStore, getStore, seedMember, makeRequest, makeAdminRequest, memberCookieValue, setupAdminPin, seedTestAdminMember,
} from './helpers';

/**
 * The string stock audit (docs/plans/string-stock-audit-fixes.md; Grant,
 * 2026-11-15: "fix 1-4 in one PR"). Each case is one of the four ways the
 * count or the cost read wrong, run on the small shelf that showed it.
 */

let n = 0;
const purchase = (o: Partial<StringPurchase> = {}): StringPurchase => ({
  id: `sp-${String(++n).padStart(16, '0')}`, kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200,
  totalCostCents: 20000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'a', ...o,
});
type Job = Pick<StringingJob, 'stringLabel' | 'status' | 'archivedAt' | 'stringColor' | 'ownString'>;
const jobs = (count: number, o: Partial<Job> = {}): Job[] =>
  Array.from({ length: count }, () => ({ stringLabel: 'BG80', status: 'picked_up' as const, ...o }));
const line = (purchases: StringPurchase[], js: Job[]) => {
  const s = summarizeStringStock({ offered: ['BG80'], links: {}, purchases, jobs: js, catalog: new Map() });
  return { line: s.lines[0], totals: s.totals };
};

describe('1. a player’s own string takes nothing off the shelf', () => {
  it('a strung job marked ownString counts no set, whatever its label', () => {
    const { line: l } = line([purchase()], [...jobs(2, { ownString: true }), ...jobs(1)]);
    expect(l.usedSets).toBe(1);
    expect(l.remainingSets).toBe(19);
  });

  it('deleting one leaves no use behind; a club-string job still does', () => {
    expect(usesASet({ status: 'picked_up', ownString: true })).toBe(false);
    expect(usesASet({ status: 'picked_up' })).toBe(true);
    expect(usesASet({ status: 'received' })).toBe(false);
  });
});

describe('2. strung past what was logged is reported, not hidden', () => {
  it('one reel and 27 jobs: none left, and 7 sets more than logged', () => {
    const { line: l, totals } = line([purchase()], jobs(27));
    expect(l.remainingSets).toBe(0);
    expect(l.overdrawnSets).toBe(7);
    expect(totals.overdrawnSets).toBe(7);
  });

  it('a few metres short is a reel’s slack, not a missing reel', () => {
    const { line: l } = line([purchase({ metresPerUnit: 205 })], jobs(21));
    expect(l.overdrawnSets).toBe(0);
  });

  it('a string with nothing logged says "No stock logged", not an overdraw', () => {
    const { line: l } = line([], jobs(4));
    expect(l.overdrawnSets).toBe(0);
  });
});

describe('3. the colour pools never add up to more than the total', () => {
  it('a white reel run dry takes the rest from the mixed reel', () => {
    const { line: l } = line([purchase({ color: 'white' }), purchase()], jobs(25, { stringColor: 'White' }));
    expect(l.byColour).toEqual([{ color: 'white', purchasedMetres: 200, usedSets: 25, remainingSets: 0 }]);
    expect(l.mixedRemainingSets).toBe(15);
    expect(l.remainingSets).toBe(15);
    expect(l.overdrawnSets).toBe(0);
  });

  it('never from a reel known to be another colour: the excess is an overdraw', () => {
    const { line: l } = line([purchase({ color: 'white' }), purchase({ color: 'red' })], jobs(25, { stringColor: 'White' }));
    const red = l.byColour.find((c) => c.color === 'red');
    expect(red?.remainingSets).toBe(20);
    expect(l.remainingSets).toBe(20);
    expect(l.overdrawnSets).toBe(5);
  });

  it('holds across a spread of shelves', () => {
    for (const whiteJobs of [0, 5, 19, 20, 21, 40]) {
      for (const mixedJobs of [0, 3, 25]) {
        const { line: l } = line(
          [purchase({ color: 'white' }), purchase({ color: 'red', metresPerUnit: 95 }), purchase({ metresPerUnit: 103 })],
          [...jobs(whiteJobs, { stringColor: 'White' }), ...jobs(mixedJobs)],
        );
        const sum = l.byColour.reduce((a, c) => a + c.remainingSets, l.mixedRemainingSets);
        expect(sum).toBeLessThanOrEqual(l.remainingSets);
      }
    }
  });
});

describe('4. one odd purchase does not set the price of every set', () => {
  it('a single retail set after a reel keeps the reel’s price', () => {
    const { line: l } = line([purchase(), purchase({ unit: 'set', metresPerUnit: 10, totalCostCents: 1500, date: '2026-11-01' })], []);
    expect(l.costPerSetCents).toBe(1000);
  });

  it('a free reel logged last keeps the paid reel’s price', () => {
    const { line: l } = line([purchase(), purchase({ totalCostCents: 0, date: '2026-11-01' })], jobs(10));
    expect(l.costPerSetCents).toBe(1000);
    expect(l.usedCostCents).toBe(10000);
  });

  it('the latest paid reel wins over an older one', () => {
    const { line: l } = line([purchase(), purchase({ totalCostCents: 24000, date: '2026-11-01' })], []);
    expect(l.costPerSetCents).toBe(1200);
  });

  it('only sets bought: the latest paid set; only gifts: $0', () => {
    expect(line([purchase({ unit: 'set', metresPerUnit: 10, totalCostCents: 1200 }), purchase({ unit: 'set', metresPerUnit: 10, totalCostCents: 1400, date: '2026-11-01' })], []).line.costPerSetCents).toBe(1400);
    expect(line([purchase({ totalCostCents: 0 })], []).line.costPerSetCents).toBe(0);
  });
});

// ── Through the routes ──────────────────────────────────────────────────────

const BASE = 'http://localhost:3000/api';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const usedSets = async () => {
  const d = (await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json()) as { lines: Array<{ label: string; usedSets: number }> };
  return d.lines.find((l) => l.label === 'BG80')?.usedSets;
};

describe('the marker, saved and read', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    resetShelfCache();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
    await shopPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/shop`, { open: true }));
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'] }));
    await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-11-01' }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  it('a player’s "I have my own" request carries it, and no colour', async () => {
    seedMember('Lin');
    const res = await requestPOST(makeRequest('POST', `${BASE}/stringing/requests`, {
      racketLabel: 'Astrox 88D', stringLabel: 'BG80', stringColor: 'White', ownString: true, tensionMains: 26, tensionCrosses: 28,
    }, { Cookie: `member_session=${memberCookieValue('Lin')}` }));
    expect(res.status).toBe(201);
    const stored = (getStore()['stringingJobs'] as StringingJob[]).at(-1)!;
    expect(stored.ownString).toBe(true);
    expect(stored.stringColor).toBeUndefined();
  });

  it('a request without it stores no field', async () => {
    seedMember('Lin');
    await requestPOST(makeRequest('POST', `${BASE}/stringing/requests`, {
      racketLabel: 'Astrox 88D', stringLabel: 'BG80', ownString: 'yes', tensionMains: 26, tensionCrosses: 28,
    }, { Cookie: `member_session=${memberCookieValue('Lin')}` }));
    expect('ownString' in (getStore()['stringingJobs'] as StringingJob[]).at(-1)!).toBe(false);
  });

  it('a bench job marked own string, strung, takes no set; marking it the club’s takes one; deleting it leaves none', async () => {
    const lin = seedMember('Lin');
    const created = await jobsPOST(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
      memberId: lin.id, memberName: 'Lin', racketLabel: 'Astrox 88D', stringLabel: 'BG80', ownString: true, tensionMains: 26, tensionCrosses: 28,
    }));
    expect(created.status).toBe(201);
    const { job } = await created.json();
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, status: 'strung' }), ctx(job.id))).status).toBe(200);
    expect(await usedSets()).toBe(0);

    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, ownString: 'no' }), ctx(job.id))).status).toBe(400);
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, ownString: false }), ctx(job.id))).status).toBe(200);
    expect(await usedSets()).toBe(1);

    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, ownString: true }), ctx(job.id))).status).toBe(200);
    expect(await usedSets()).toBe(0);
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, archived: true }), ctx(job.id))).status).toBe(200);
    expect((await jobDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, confirm: true }), ctx(job.id))).status).toBe(200);
    const uses = ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string }>).filter((r) => r.kind === 'stringUse');
    expect(uses).toHaveLength(0);
    expect(await usedSets()).toBe(0);
  });
});
