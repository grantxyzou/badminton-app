import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as earningsGET } from '@/app/api/stringing/earnings/route';
import { DELETE as jobDELETE } from '@/app/api/stringing/jobs/[id]/route';
import { GET as reportGET } from '@/app/api/reports/metrics/route';
import { GET as adminMetricsGET } from '@/app/api/admin/metrics/route';
import { mintReportsKey } from '@/lib/reportsAccess';
import { purgeMember } from '@/lib/memberPurge';
import { GET as stockGET } from '@/app/api/stringing/stock/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, getStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember, memberCookieValue } from './helpers';

/**
 * The two-club gate for the earnings read (docs/plans/stringing-earnings.md):
 * another club's jobs and purchases never reach BPM's months, and a member who
 * is not an admin is refused before anything is read.
 */

const BASE = 'http://localhost:3000/api';
const strungNow = () => new Date(Date.now() - 2 * 86_400_000).toISOString();

beforeEach(async () => {
  resetMockStore();
  __resetCatalogSeedForTests();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('stringing earnings', () => {
  it("adds up BPM's jobs only, and prices the string off BPM's shelf", async () => {
    const lin = seedMember('Lin');
    const at = strungNow();
    const history = [{ status: 'strung', at }, { status: 'ready', at }];
    seedDoc('clubSettings', { id: 'stringing-strings', groupId: 'bpm', strings: ['BG80'], links: {}, updatedAt: '', updatedBy: null });
    seedDoc('clubSettings', { id: 'sp-0000000000000bbb', groupId: 'bpm', kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'x' });
    seedDoc('stringingJobs', { id: 'job-bpm', groupId: 'bpm', memberId: lin.id, jobNo: 'J-0001', memberName: 'Lin', stringLabel: 'BG80', status: 'ready', priceCents: 3000, paidAt: null, createdAt: at, history });
    seedDoc('stringingJobs', { id: 'job-other', groupId: 'other', memberId: lin.id, jobNo: 'J-0001', memberName: 'Lin', stringLabel: 'BG80', status: 'picked_up', priceCents: 9900, paidAt: at, createdAt: at, history });
    seedDoc('clubSettings', { id: 'sp-0000000000000aaa', groupId: 'other', kind: 'stringPurchase', label: 'BG80', unit: 'set', units: 1, metresPerUnit: 10, totalCostCents: 9900, date: '2026-10-01', createdAt: '2026-11-01T00:00:00Z', createdBy: 'x' });

    const res = await earningsGET(makeAdminRequest('GET', `${BASE}/stringing/earnings`));
    expect(res.status).toBe(200);
    const body = await res.json();
    const month = body.months.find((m: { jobs: number }) => m.jobs > 0);
    expect(month).toMatchObject({ jobs: 1, workCents: 3000, owedCents: 3000, collectedCents: 0, stringCostCents: 1000 });
    expect(month.waiting).toEqual([expect.objectContaining({ jobId: 'job-bpm', state: 'owed', amountCents: 3000 })]);
    expect(body.strings).toEqual([expect.objectContaining({ key: 's:BG80', purchasedCostCents: 20000, allTimeWorkCents: 3000 })]);
  });

  const shelf = () => {
    seedDoc('clubSettings', { id: 'stringing-strings', groupId: 'bpm', strings: ['BG80'], links: {}, updatedAt: '', updatedBy: null });
    seedDoc('clubSettings', { id: 'sp-0000000000000bbb', groupId: 'bpm', kind: 'stringPurchase', label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 20000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'x' });
  };
  const del = (id: string, memberId: string) =>
    jobDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/jobs/${id}`, { memberId, confirm: true }), { params: Promise.resolve({ id }) });
  const earned = async () => {
    const body = await (await earningsGET(makeAdminRequest('GET', `${BASE}/stringing/earnings`))).json();
    return body.months.reduce(
      (t: { jobs: number; workCents: number; collectedCents: number; stringCostCents: number }, m: typeof t) => ({
        jobs: t.jobs + m.jobs, workCents: t.workCents + m.workCents, collectedCents: t.collectedCents + m.collectedCents, stringCostCents: t.stringCostCents + m.stringCostCents,
      }),
      { jobs: 0, workCents: 0, collectedCents: 0, stringCostCents: 0 },
    );
  };

  it('a deleted PAID job still counts; a deleted unpaid one does not', async () => {
    const lin = seedMember('Lin');
    const at = strungNow();
    const history = [{ status: 'strung', at }, { status: 'ready', at }, { status: 'picked_up', at }];
    shelf();
    const base = { groupId: 'bpm', memberId: lin.id, memberName: 'Lin', stringLabel: 'BG80', status: 'picked_up', createdAt: at, archivedAt: at, history };
    seedDoc('stringingJobs', { ...base, id: 'job-paid', jobNo: 'J-0001', priceCents: 3000, paidAt: at });
    seedDoc('stringingJobs', { ...base, id: 'job-own', jobNo: 'J-0002', priceCents: 1500, paidAt: at, ownString: true, stringLabel: 'Lin’s lucky string', stringColor: 'Red' });
    seedDoc('stringingJobs', { ...base, id: 'job-unpaid', jobNo: 'J-0003', priceCents: 2800, paidAt: null });
    const before = await earned();
    expect(before).toEqual({ jobs: 3, workCents: 7300, collectedCents: 4500, stringCostCents: 2000 });

    for (const id of ['job-paid', 'job-own', 'job-unpaid']) expect((await del(id, lin.id)).status).toBe(200);
    expect(getStore()['stringingJobs'] ?? []).toHaveLength(0);

    // The two paid jobs stay, with the one set of club string the first used.
    // The unpaid one's set is still off the shelf (the stock's rule), but it
    // earned nothing, so it is not in Earnings.
    expect(await earned()).toEqual({ jobs: 2, workCents: 4500, collectedCents: 4500, stringCostCents: 1000 });
    // What the rows keep: the money and the days. Never who.
    const uses = (getStore()['clubSettings'] as Array<Record<string, unknown>>).filter((r) => r.kind === 'stringUse');
    expect(uses.map((u) => u.jobId).sort()).toEqual(['job-own', 'job-paid', 'job-unpaid']);
    expect(uses.find((u) => u.jobId === 'job-paid')).toMatchObject({ priceCents: 3000, paidAt: at });
    expect(uses.find((u) => u.jobId === 'job-unpaid')).not.toHaveProperty('priceCents');
    // The player's own string keeps no name: it was never the club's, and an
    // empty label is what an older build skips instead of counting a set.
    const own = uses.find((u) => u.jobId === 'job-own')!;
    expect(own).toMatchObject({ ownString: true, stringLabel: '', priceCents: 1500 });
    expect(own).not.toHaveProperty('stringColor');
    expect(JSON.stringify(uses)).not.toMatch(/Lin|memberId|J-000/);
  });

  it('an account deletion keeps a paid restring in Earnings and its set off the shelf', async () => {
    const lin = seedMember('Lin');
    const at = strungNow();
    const history = [{ status: 'strung', at }, { status: 'ready', at }, { status: 'picked_up', at }];
    shelf();
    seedDoc('stringingJobs', { id: 'job-lin', groupId: 'bpm', memberId: lin.id, jobNo: 'J-0001', memberName: 'Lin', stringLabel: 'BG80', status: 'picked_up', priceCents: 3000, paidAt: at, createdAt: at, history });
    const usedSets = async () => (await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json()).lines[0].usedSets;
    expect(await earned()).toMatchObject({ jobs: 1, collectedCents: 3000, stringCostCents: 1000 });
    expect(await usedSets()).toBe(1);

    const summary = await purgeMember(lin.id, 'Lin');
    expect(summary.failed).toEqual([]);
    expect(getStore()['stringingJobs'] ?? []).toHaveLength(0);

    expect(await earned()).toEqual({ jobs: 1, workCents: 3000, collectedCents: 3000, stringCostCents: 1000 });
    expect(await usedSets()).toBe(1);
    // The row that keeps it says nothing about who.
    const uses = (getStore()['clubSettings'] as Array<Record<string, unknown>>).filter((r) => r.kind === 'stringUse');
    expect(uses).toHaveLength(1);
    expect(JSON.stringify(uses)).not.toMatch(new RegExp(`Lin|${lin.id}|J-0001`));
  });

  it('the club report and the admin Metrics read carry the same totals as the page, and no name', async () => {
    const lin = seedMember('Lin');
    const at = strungNow();
    const history = [{ status: 'strung', at }, { status: 'ready', at }];
    shelf();
    seedDoc('stringingJobs', { id: 'job-a', groupId: 'bpm', memberId: lin.id, jobNo: 'J-0001', memberName: 'Lin', stringLabel: 'BG80', status: 'picked_up', priceCents: 3000, paidAt: at, createdAt: at, history });
    seedDoc('stringingJobs', { id: 'job-b', groupId: 'bpm', memberId: lin.id, jobNo: 'J-0002', memberName: 'Lin', stringLabel: 'BG80', status: 'ready', priceCents: 2800, paidAt: null, createdAt: at, history });
    seedDoc('stringingJobs', { id: 'job-other', groupId: 'other', memberId: lin.id, jobNo: 'J-0001', memberName: 'Lin', stringLabel: 'BG80', status: 'picked_up', priceCents: 9900, paidAt: at, createdAt: at, history });
    const page = await earned();

    const key = await mintReportsKey('bpm');
    const report = await (await reportGET(makeRequest('GET', `${BASE}/reports/metrics`, undefined, { 'x-reports-key': key }))).json();
    expect(report.stringEarnings.totals).toMatchObject({
      jobs: page.jobs, workCents: page.workCents, collectedCents: page.collectedCents, stringCostCents: page.stringCostCents,
      owedCents: 2800, afterStringCostCents: 5800 - 2000, waitingJobs: 1,
    });
    expect(JSON.stringify(report.stringEarnings)).not.toMatch(/Lin|J-000|job-/);

    const admin = await (await adminMetricsGET(makeAdminRequest('GET', `${BASE}/admin/metrics`))).json();
    expect(admin.stringEarnings).toEqual(report.stringEarnings);
  });

  it('refuses a member who is not an admin', async () => {
    const lin = seedMember('Lin');
    const res = await earningsGET(makeRequest('GET', `${BASE}/stringing/earnings`, undefined, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(res.status).toBe(401);
  });
});
