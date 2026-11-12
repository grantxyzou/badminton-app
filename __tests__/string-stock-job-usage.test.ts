import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { GET as stringsGET, PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { POST as jobsPOST } from '@/app/api/stringing/jobs/route';
import { PATCH as jobPATCH, DELETE as jobDELETE } from '@/app/api/stringing/jobs/[id]/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { summarizeStringStock, withDeletedUses, compactKey } from '@/lib/stringStock';
import type { CatalogItem } from '@/lib/types';
import { resetMockStore, getStore, seedMember, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * Grant, 2026-11-12: "the stock is not going down based on the archived and
 * finished stringing job". Two causes, both pinned here through the real routes:
 * a bench job named the way the player's bag names the string ("Yonex BG80")
 * matched no shelf label, and deleting an archived job took its set back.
 */
const BASE = 'http://localhost:3000/api';

beforeEach(async () => {
  resetMockStore();
  __resetCatalogSeedForTests();
  resetShelfCache();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const stock = async () => (await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json()) as {
  lines: Array<{ label: string; usedSets: number; remainingSets: number }>;
  unmatched: Array<{ label: string; usedSets: number }>;
};

/** A shelf of BG80 (linked to the catalog), five sets bought, and Lin on the roster. */
async function setUp() {
  await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'], links: { BG80: 'string-yx-bg80' } }));
  const bought = await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, { label: 'BG80', catalogId: 'string-yx-bg80', unit: 'set', units: 5, metresPerUnit: 10, totalCostCents: 5000, date: '2026-11-01' }));
  expect(bought.status).toBe(201);
  return seedMember('Lin');
}

/** A bench job for Lin, finished (picked up) and archived. */
async function finishedJob(memberId: string, stringLabel: string) {
  const res = await jobsPOST(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
    memberId, memberName: 'Lin', racketLabel: 'Astrox 88D', stringLabel, tensionMains: 26, tensionCrosses: 28,
  }));
  expect(res.status).toBe(201);
  const { job } = await res.json();
  for (const status of ['strung', 'ready', 'picked_up']) {
    expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId, status }), ctx(job.id))).status).toBe(200);
  }
  expect((await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId, archived: true }), ctx(job.id))).status).toBe(200);
  return job.id as string;
}

describe('a finished, archived job uses a set', () => {
  it('when its label is the shelf label', async () => {
    const lin = await setUp();
    await finishedJob(lin.id, 'BG80');
    expect((await stock()).lines[0]).toMatchObject({ label: 'BG80', usedSets: 1, remainingSets: 4 });
  });

  it('when the bench named it the way the player’s bag does ("Yonex BG80")', async () => {
    const lin = await setUp();
    await finishedJob(lin.id, 'Yonex BG80');
    const s = await stock();
    expect(s.lines[0]).toMatchObject({ label: 'BG80', usedSets: 1, remainingSets: 4 });
    expect(s.unmatched).toEqual([]);
  });

  it('when it was typed with a space or a dash', async () => {
    const lin = await setUp();
    await finishedJob(lin.id, 'bg 80');
    await finishedJob(lin.id, 'BG-80');
    expect((await stock()).lines[0]).toMatchObject({ usedSets: 2, remainingSets: 3 });
  });

  it('and still after the archived job is deleted, on the bench and on the member’s shelf', async () => {
    const lin = await setUp();
    const id = await finishedJob(lin.id, 'BG80');
    const del = await jobDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/jobs/${id}`, { memberId: lin.id, confirm: true }), ctx(id));
    expect(del.status).toBe(200);
    expect(((getStore()['stringingJobs'] ?? []) as Array<{ id: string }>).some((j) => j.id === id)).toBe(false);
    expect((await stock()).lines[0]).toMatchObject({ usedSets: 1, remainingSets: 4 });
    // The row left behind names the string and nothing about the person.
    const use = ((getStore()['clubSettings'] ?? []) as Array<Record<string, unknown>>).find((d) => d.kind === 'stringUse');
    expect(use).toMatchObject({ id: `su-${id}`, jobId: id, stringLabel: 'BG80', groupId: 'bpm' });
    expect(use).not.toHaveProperty('memberId');
    expect(use).not.toHaveProperty('memberName');
    // The member-facing shelf reads the same count.
    resetShelfCache();
    const shelf = await (await stringsGET(makeAdminRequest('GET', `${BASE}/stringing/strings`))).json();
    expect(shelf.stock).toEqual({ BG80: 'in' });
  });

  it('a job deleted before its string went in leaves nothing behind', async () => {
    const lin = await setUp();
    const res = await jobsPOST(makeAdminRequest('POST', `${BASE}/stringing/jobs`, { memberId: lin.id, memberName: 'Lin', racketLabel: 'X', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28 }));
    const { job } = await res.json();
    await jobPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, archived: true }), ctx(job.id));
    expect((await jobDELETE(makeAdminRequest('DELETE', `${BASE}/stringing/jobs/${job.id}`, { memberId: lin.id, confirm: true }), ctx(job.id))).status).toBe(200);
    expect(((getStore()['clubSettings'] ?? []) as Array<{ kind?: string }>).some((d) => d.kind === 'stringUse')).toBe(false);
    expect((await stock()).lines[0]).toMatchObject({ usedSets: 0, remainingSets: 5 });
  });
});

describe('the matching rules', () => {
  const catalog = new Map<string, CatalogItem>([
    ['string-a', { id: 'string-a', category: 'string', brand: 'Yonex', model: 'BG80', attributes: {} } as unknown as CatalogItem],
    ['string-b', { id: 'string-b', category: 'string', brand: 'Yonex', model: 'BG80 Power', attributes: {} } as unknown as CatalogItem],
  ]);
  const used = (offered: string[], links: Record<string, string>, label: string) =>
    summarizeStringStock({ offered, links, purchases: [], jobs: [{ stringLabel: label, status: 'strung', archivedAt: undefined }], catalog });

  it('a name two shelf strings could both claim is left unmatched, never guessed', () => {
    // Both shelf labels compact to the same key.
    const s = used(['BG 80', 'BG-80'], {}, 'bg80');
    expect(s.lines.every((l) => l.usedSets === 0)).toBe(true);
    expect(s.unmatched).toEqual([{ label: 'bg80', usedSets: 1 }]);
  });

  it('the catalog name of a linked string finds it; an unlinked one does not', () => {
    expect(used(['Shelf BG80'], { 'Shelf BG80': 'string-a' }, 'Yonex BG80').lines[0].usedSets).toBe(1);
    expect(used(['Shelf BG80'], {}, 'Yonex BG80').lines[0].usedSets).toBe(0);
  });

  it('BG80 and BG80 Power stay apart', () => {
    const s = used(['BG80', 'BG80 Power'], { BG80: 'string-a', 'BG80 Power': 'string-b' }, 'Yonex BG80 Power');
    expect(s.lines.find((l) => l.label === 'BG80 Power')?.usedSets).toBe(1);
    expect(s.lines.find((l) => l.label === 'BG80')?.usedSets).toBe(0);
  });

  it('compactKey keeps letters and digits in any script', () => {
    expect(compactKey(' BG-80 ')).toBe('bg80');
    expect(compactKey('伊索 80')).toBe('伊索80');
  });

  it('a deleted job’s row is not counted while the job itself still exists', () => {
    const job = { id: 'j1', stringLabel: 'BG80', status: 'picked_up' as const, archivedAt: 'x' };
    const use = { id: 'su-j1', kind: 'stringUse' as const, jobId: 'j1', stringLabel: 'BG80', deletedAt: 'x' };
    expect(withDeletedUses([job], [use])).toHaveLength(1);
    expect(withDeletedUses([], [use])).toHaveLength(1);
  });
});
