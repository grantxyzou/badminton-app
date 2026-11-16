import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as CREATE } from '../app/api/stringing/jobs/route';
import { PATCH, DELETE } from '../app/api/stringing/jobs/[id]/route';
import { POST as ACCEPT } from '../app/api/stringing/jobs/[id]/accept/route';
import { PATCH as SHELF } from '../app/api/stringing/strings/route';
import * as strings from '../lib/stringingStrings';
import { resetShelfCache } from '../lib/stringShelfRead';
import {
  resetMockStore,
  getStore,
  seedMember,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * The stringing code review of 2026-11-16: what a stringer's tap answers,
 * job numbers that never repeat, a shelf save that cannot erase another, and
 * a price proposal that a payment ends.
 */
vi.mock('../lib/stringingStrings', async (load) => {
  const actual = await load<typeof import('../lib/stringingStrings')>();
  return { ...actual, readOfferedStringsWithLinks: vi.fn(actual.readOfferedStringsWithLinks) };
});

const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

beforeEach(async () => {
  resetMockStore();
  resetShelfCache();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

function seedJob(over: Partial<StringingJob> = {}): StringingJob {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const now = new Date().toISOString();
  const job: StringingJob = {
    id: `job-${Math.random().toString(16).slice(2, 10)}`,
    memberId: 'member-wei', jobNo: 'J-0042', memberName: 'Wei',
    stringerId: null, stringerName: null, status: 'received',
    racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
    method: 'Zach · 2 strings, 4 knots', priceCents: 3000, readyBy: null,
    acceptedAt: null, paidAt: null, sessionId: null,
    createdAt: now, updatedAt: now, history: [], ...over,
  };
  store['stringingJobs'].push(job);
  return job;
}

const stored = (id: string) => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === id)!;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const asMember = (method: string, url: string, name: string, id: string, body?: Record<string, unknown>) =>
  makeRequest(method, url, body, { Cookie: `member_session=${memberCookieValue(name, id)}` });

describe("a stringer's tap answers in a stringer's shape", () => {
  it('carries no price, payment or price proposal', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = seedJob({
      stringerId: zach.id, stringerName: 'Zach', status: 'strung', paidAt: '2026-11-01T00:00:00Z',
      pendingEdit: { proposedAt: '2026-11-01T00:00:00Z', proposedBy: null, priceCents: 3500 },
    });
    const res = await PATCH(asMember('PATCH', `http://x/jobs/${job.id}`, 'Zach', zach.id, { memberId: job.memberId, status: 'ready' }), ctx(job.id));
    expect(res.status).toBe(200);
    const answer = (await res.json()).job;
    expect(answer.status).toBe('ready');
    expect(answer).not.toHaveProperty('priceCents');
    expect(answer).not.toHaveProperty('paidAt');
    expect(JSON.stringify(answer)).not.toMatch(/3500|3000|priceFrom|priceTo/);
  });

  it("an admin's tap still answers the whole job", async () => {
    const job = seedJob();
    const res = await PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, status: 'strung' }), ctx(job.id));
    expect((await res.json()).job.priceCents).toBe(3000);
  });
});

describe('job numbers never repeat', () => {
  const create = () =>
    CREATE(makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
      memberId: 'member-wei', memberName: 'Wei', racketLabel: 'Astrox 88D', stringLabel: 'BG80',
      tensionMains: 25, tensionCrosses: 26,
    }));
  const jobNo = async (res: Response) => ((await res.json()).job as StringingJob).jobNo;

  it('a deleted job does not hand its number to the next one', async () => {
    expect(await jobNo(await create())).toBe('J-0001');
    const second = (await (await create()).json()).job as StringingJob;
    expect(second.jobNo).toBe('J-0002');
    await PATCH(makeAdminRequest('PATCH', `http://x/jobs/${second.id}`, { memberId: second.memberId, archived: true }), ctx(second.id));
    const del = await DELETE(makeAdminRequest('DELETE', `http://x/jobs/${second.id}`, { memberId: second.memberId, confirm: true }), ctx(second.id));
    expect(del.status).toBe(200);
    // Was "count + 1" = J-0002 again.
    expect(await jobNo(await create())).toBe('J-0003');
  });

  it('creates landing together take different numbers', async () => {
    const numbers = await Promise.all([create(), create(), create()].map(async (p) => jobNo(await p)));
    expect(new Set(numbers).size).toBe(3);
  });

  it("a club's first counted job follows the highest number its jobs already carry", async () => {
    seedJob({ jobNo: 'J-0007' });
    seedJob({ jobNo: 'J-0003' });
    expect(await jobNo(await create())).toBe('J-0008');
  });
});

describe('a shelf save cannot erase another', () => {
  it('answers 409 when the list changed after it was read', async () => {
    const save = (body: Record<string, unknown>) => SHELF(makeAdminRequest('PATCH', 'http://x/api/stringing/strings', body));
    expect((await save({ strings: ['BG80', 'BG65'] })).status).toBe(200);

    // Someone else's save lands between this save's read and its write.
    const read = vi.mocked(strings.readOfferedStringsWithLinks);
    read.mockImplementationOnce(async (groupId) => {
      // A new version in the store, as a real write leaves (the mock hands out
      // the stored object itself, so the earlier read is not touched).
      const docs = getStore()['clubSettings'] as Array<Record<string, unknown>>;
      const at = docs.findIndex((d) => d.id === strings.stringsDocId(groupId));
      docs[at] = { ...docs[at], _etag: 'changed-by-someone-else' };
      return vi.importActual<typeof import('../lib/stringingStrings')>('../lib/stringingStrings').then((m) => m.readOfferedStringsWithLinks(groupId));
    });
    const res = await save({ rename: { from: 'BG80', to: 'BG80 Power' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('changed_elsewhere');
  });

  it('an ordinary save still lands, first save included', async () => {
    const save = (body: Record<string, unknown>) => SHELF(makeAdminRequest('PATCH', 'http://x/api/stringing/strings', body));
    expect((await save({ strings: ['BG80'] })).status).toBe(200);
    const renamed = await save({ rename: { from: 'BG80', to: 'BG80 Power' } });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).strings).toEqual(['BG80 Power']);
  });
});

describe('a payment ends a proposed new price', () => {
  const proposal = { proposedAt: '2026-11-01T00:00:00Z', proposedBy: null, priceCents: 3500 };

  it('marking the job paid withdraws it', async () => {
    const job = seedJob({ status: 'ready', pendingEdit: proposal });
    const res = await PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, paid: true }), ctx(job.id));
    expect(res.status).toBe(200);
    expect(stored(job.id).pendingEdit).toBeNull();
    expect(stored(job.id).priceCents).toBe(3000);
  });

  it('a proposal that changes no price stays', async () => {
    const job = seedJob({ status: 'ready', pendingEdit: { proposedAt: '2026-11-01T00:00:00Z', proposedBy: null, tensionMains: 27 } });
    await PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, paid: true }), ctx(job.id));
    expect(stored(job.id).pendingEdit?.tensionMains).toBe(27);
  });

  it('accepting after a payment made elsewhere refuses once and clears the prompt', async () => {
    seedMember('Wei', { id: 'member-wei' });
    const job = seedJob({ status: 'ready', paidAt: '2026-11-02T00:00:00Z', pendingEdit: proposal });
    const res = await ACCEPT(asMember('POST', `http://x/jobs/${job.id}/accept`, 'Wei', 'member-wei', { decision: 'accept' }), ctx(job.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('job_paid');
    expect(stored(job.id).pendingEdit).toBeNull();
    expect(stored(job.id).priceCents).toBe(3000);
  });
});
