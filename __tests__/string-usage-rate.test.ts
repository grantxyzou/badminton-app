import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as stockPOST } from '@/app/api/stringing/stock/route';
import { PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { POST as jobsPOST } from '@/app/api/stringing/jobs/route';
import { PATCH as jobPATCH, DELETE as jobDELETE } from '@/app/api/stringing/jobs/[id]/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { summarizeStringStock, strungAtOf, stringReorder, RATE_WINDOW_WEEKS } from '@/lib/stringStock';
import { buildStringShelfReport, readStringShelfReport } from '@/lib/stringStockReport';
import type { StringPurchase, StringingJob } from '@/lib/types';
import { resetMockStore, getStore, seedMember, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The string usage rate (docs/plans/string-usage-rate.md; Grant, 2026-11-15:
 * "option 2 tracks the usage rate", "Usage rate first"): sets strung a week,
 * how long the shelf lasts at that rate, and the report block the reports key
 * reads.
 */

const NOW = new Date('2026-11-15T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const reel = (o: Partial<StringPurchase> = {}): StringPurchase => ({
  id: 'sp-0000000000000001', kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200,
  totalCostCents: 20000, date: '2026-09-01', createdAt: '2026-09-01T00:00:00Z', createdBy: 'a', ...o,
});
type Job = Pick<StringingJob, 'stringLabel' | 'status' | 'archivedAt' | 'stringColor' | 'ownString'> & { strungAt?: string };
const strung = (at: string, o: Partial<Job> = {}): Job => ({ stringLabel: 'BG80', status: 'picked_up', strungAt: at, ...o });
/** `now: null` reads with no clock (a default parameter would swallow `undefined`). */
const line = (jobs: Job[], purchases: StringPurchase[] = [reel()], now: Date | null = NOW) =>
  summarizeStringStock({ offered: ['BG80'], links: {}, purchases, jobs, catalog: new Map(), ...(now ? { now } : {}) }).lines[0];

describe('when a string went in', () => {
  it('is the first move to strung in the job’s history', () => {
    expect(strungAtOf({ history: [
      { status: 'received', at: '2026-11-01T00:00:00Z', by: null },
      { status: 'strung', at: '2026-11-02T00:00:00Z', by: null },
      { status: 'ready', at: '2026-11-03T00:00:00Z', by: null },
      { status: 'strung', at: '2026-11-04T00:00:00Z', by: null },
    ] })).toBe('2026-11-02T00:00:00Z');
    expect(strungAtOf({ history: [{ status: 'received', at: '2026-11-01T00:00:00Z', by: null }] })).toBeUndefined();
    expect(strungAtOf({})).toBeUndefined();
  });
});

describe('sets strung a week', () => {
  it('is counted over the last 8 weeks', () => {
    // 16 in the window (2 a week), and 10 older ones that must not count.
    const jobs = [...Array.from({ length: 16 }, (_, i) => strung(daysAgo(1 + i * 3))), ...Array.from({ length: 10 }, () => strung(daysAgo(70)))];
    expect(RATE_WINDOW_WEEKS).toBe(8);
    expect(line(jobs, [reel({ metresPerUnit: 400 })]).setsPerWeek).toBe(2);
  });

  it('a club that started three weeks ago is divided by three, not eight', () => {
    const jobs = Array.from({ length: 6 }, (_, i) => strung(daysAgo(21 - i * 3)));
    expect(line(jobs).setsPerWeek).toBeCloseTo(2, 5);
  });

  it('never over less than a week: one job this morning is one a week, not seven', () => {
    expect(line([strung(daysAgo(0.2))]).setsPerWeek).toBe(1);
  });

  it('a player’s own string is not a set used', () => {
    const jobs = [...Array.from({ length: 4 }, (_, i) => strung(daysAgo(1 + i))), ...Array.from({ length: 4 }, (_, i) => strung(daysAgo(1 + i), { ownString: true }))];
    expect(line(jobs).setsPerWeek).toBe(4);
  });

  it('is unknown without a clock or a single dated job; 0 when this string was not strung in the window', () => {
    expect(line([strung(daysAgo(3))], [reel()], null).setsPerWeek).toBeNull();
    expect(line([{ stringLabel: 'BG80', status: 'picked_up' }]).setsPerWeek).toBeNull();
    const other = summarizeStringStock({
      offered: ['BG80', 'BG65'], links: {}, purchases: [reel(), reel({ id: 'sp-0000000000000002', label: 'BG65' })],
      jobs: [strung(daysAgo(3))], catalog: new Map(), now: NOW,
    }).lines.find((l) => l.label === 'BG65')!;
    expect(other.setsPerWeek).toBe(0);
    expect(other.weeksLeft).toBeNull();
    expect(other.reorder).toBeNull();
  });
});

describe('how long it lasts, and when to reorder', () => {
  // 2 a week over the last 4 weeks (the club's first job was 4 weeks ago).
  const twoAWeek = Array.from({ length: 8 }, (_, i) => strung(daysAgo(28 - i * 3.5)));

  it('weeks left is the sets left over the rate', () => {
    const l = line(twoAWeek); // 200 m − 8 sets = 12 sets left
    expect(l.remainingSets).toBe(12);
    expect(l.weeksLeft).toBeCloseTo(6, 5);
    expect(l.reorder).toBe('ok');
  });

  it('the shuttles’ two lines: under 2 weeks is now, under 4 is soon', () => {
    expect(stringReorder({ purchases: 1, remainingSets: 3, setsPerWeek: 2 })).toBe('now');
    expect(stringReorder({ purchases: 1, remainingSets: 6, setsPerWeek: 2 })).toBe('soon');
    expect(stringReorder({ purchases: 1, remainingSets: 8, setsPerWeek: 2 })).toBe('ok');
    expect(stringReorder({ purchases: 1, remainingSets: 0, setsPerWeek: 2 })).toBe('now');
  });

  it('no purchase logged, or no rate, is no telling — never "plenty"', () => {
    expect(stringReorder({ purchases: 0, remainingSets: 0, setsPerWeek: 2 })).toBeNull();
    expect(stringReorder({ purchases: 1, remainingSets: 5, setsPerWeek: 0 })).toBeNull();
    expect(stringReorder({ purchases: 1, remainingSets: 5, setsPerWeek: null })).toBeNull();
    expect(line(twoAWeek, []).weeksLeft).toBeNull();
  });
});

describe('the report block', () => {
  it('counts every stage, archived and own-string, from the jobs still stored', () => {
    const summary = summarizeStringStock({ offered: ['BG80'], links: {}, purchases: [reel()], jobs: [], catalog: new Map(), now: NOW });
    const r = buildStringShelfReport(summary, [
      { status: 'requested' }, { status: 'strung' }, { status: 'picked_up', archivedAt: daysAgo(2) },
      { status: 'picked_up', archivedAt: daysAgo(9), ownString: true },
    ] as Array<Pick<StringingJob, 'status' | 'archivedAt' | 'ownString'>>);
    expect(r.jobs).toEqual({
      total: 4, live: 2, archived: 2, ownString: 1,
      byStatus: { requested: 1, received: 0, strung: 1, ready: 0, picked_up: 2 },
    });
    expect(r.lines[0]).toMatchObject({ label: 'BG80', remainingSets: 20, setsPerWeek: null, reorder: null, costPerSetCents: 1000 });
    expect(JSON.stringify(r)).not.toMatch(/memberName|memberId|walkUpContact/);
  });
});

// ── Through the routes ──────────────────────────────────────────────────────

const BASE = 'http://localhost:3000/api';
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('through the routes', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    resetShelfCache();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'] }));
    await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-11-01' }));
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  async function strungJob(memberId: string) {
    const res = await jobsPOST(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
      memberId, memberName: 'Lin', racketLabel: 'Astrox 88D', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
    }));
    const { job } = await res.json();
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId, status: 'strung' }), ctx(job.id))).status).toBe(200);
    return job.id as string;
  }

  it('the report reads the shelf with a rate, and a deleted job keeps its date', async () => {
    const lin = seedMember('Lin');
    await strungJob(lin.id);
    const gone = await strungJob(lin.id);
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${gone}`, { memberId: lin.id, archived: true }), ctx(gone))).status).toBe(200);
    expect((await jobDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/jobs/${gone}`, { memberId: lin.id, confirm: true }), ctx(gone))).status).toBe(200);

    const use = ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string; strungAt?: string }>).find((r) => r.kind === 'stringUse');
    expect(typeof use?.strungAt).toBe('string');

    const report = await readStringShelfReport('bpm', new Date());
    expect(report).not.toBeNull();
    const bg80 = report!.lines.find((l) => l.label === 'BG80')!;
    expect(bg80.usedSets).toBe(2);
    // Both strung today: the window is its one-week floor, so 2 a week.
    expect(bg80.setsPerWeek).toBe(2);
    expect(bg80.remainingSets).toBe(18);
    expect(bg80.weeksLeft).toBe(9);
    expect(report!.jobs.total).toBe(1);
    expect(report!.jobs.byStatus.strung).toBe(1);
  });

  it('is null for a deployment without stringing', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    expect(await readStringShelfReport('bpm', new Date())).toBeNull();
  });
});
