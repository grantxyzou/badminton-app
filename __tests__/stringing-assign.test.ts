import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '../app/api/stringing/jobs/route';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import { GET as STRINGERS } from '../app/api/stringing/stringers/route';
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
 * ASSIGNING A JOB TO A STRINGER.
 *
 * `canString` is deliberately NOT `role === 'admin'` — stringing and
 * administering are different jobs, and the bench used to conflate them:
 * `stringerId` was simply whichever admin tapped "Take this one", so the only
 * way to let somebody restring for the club was to make them a full admin.
 *
 * Two properties carry the weight here: a stringer sees the SPEC and never the
 * money, and they can move their own job along and touch nothing else.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

function memberReq(method: string, url: string, name: string, body?: Record<string, unknown>) {
  return makeRequest(method, url, body, { Cookie: `member_session=${memberCookieValue(name)}` });
}

async function seedJob(over: Partial<StringingJob> = {}): Promise<StringingJob> {
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

const patch = (job: StringingJob, body: Record<string, unknown>) =>
  PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, ...body }),
    { params: Promise.resolve({ id: job.id }) });

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('a stringer does not have to be an admin', () => {
  it('lists members flagged canString, not admins', async () => {
    seedMember('Zach', { id: 'member-zach', canString: true });
    seedMember('Priya', { id: 'member-priya' }); // ordinary member
    const res = await STRINGERS(makeAdminRequest('GET', 'http://x/stringers'));
    const body = await res.json();
    expect(body.stringers.map((s: { name: string }) => s.name)).toEqual(['Zach']);
  });

  it('assigns a job to one of them', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = await seedJob();
    const res = await patch(job, { stringerId: zach.id });
    expect(res.status).toBe(200);
    const after = (await res.json()).job as StringingJob;
    expect(after.stringerId).toBe(zach.id);
    // Denormalised beside the id, like every other name on the doc.
    expect(after.stringerName).toBe('Zach');
  });

  it('refuses to assign someone who does not string', async () => {
    // The picker is a convenience; this is the gate.
    const priya = seedMember('Priya', { id: 'member-priya' });
    const job = await seedJob();
    const res = await patch(job, { stringerId: priya.id });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('not_a_stringer');
  });

  it('unassigns with null', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = await seedJob({ stringerId: zach.id, stringerName: 'Zach' });
    const after = (await (await patch(job, { stringerId: null })).json()).job as StringingJob;
    expect(after.stringerId).toBeNull();
    expect(after.stringerName).toBeNull();
  });
});

describe('a stringer sees the spec and never the money', () => {
  it('returns their assigned jobs without any price', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    await seedJob({ stringerId: zach.id, stringerName: 'Zach', priceCents: 3000 });

    const res = await GET(memberReq('GET', 'http://x/jobs?view=stringer', 'zach'));
    const body = await res.json();
    expect(body.view).toBe('stringer');
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].racketLabel).toBe('Astrox 99 Pro');
    // The bench vocabulary — they are working the bench.
    expect(body.jobs[0].status).toBe('received');

    // Asserted on the SERIALISED body: the failure to guard against is the
    // figure riding along in JSON while the UI happens not to show it.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('priceCents');
    expect(raw).not.toContain('3000');
    expect(raw).not.toContain('paidAt');
  });

  it('shows them only their OWN jobs', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const other = seedMember('Kai', { id: 'member-kai', canString: true });
    await seedJob({ jobNo: 'J-MINE', stringerId: zach.id, stringerName: 'Zach' });
    await seedJob({ jobNo: 'J-THEIRS', stringerId: other.id, stringerName: 'Kai' });

    const body = await (await GET(memberReq('GET', 'http://x/jobs?view=stringer', 'zach'))).json();
    expect(body.jobs.map((j: { jobNo: string }) => j.jobNo)).toEqual(['J-MINE']);
  });

  it('gives a member without the flag an empty list, not the bench', async () => {
    seedMember('Priya', { id: 'member-priya' });
    await seedJob();
    const body = await (await GET(memberReq('GET', 'http://x/jobs?view=stringer', 'priya'))).json();
    expect(body.jobs).toEqual([]);
  });
});

describe('a stringer may move their own job, and nothing else', () => {
  const asZach = (job: StringingJob, body: Record<string, unknown>) =>
    PATCH(memberReq('PATCH', `http://x/jobs/${job.id}`, 'zach', { memberId: job.memberId, ...body }),
      { params: Promise.resolve({ id: job.id }) });

  it('advances the status of a job assigned to them', async () => {
    // The person doing the work is the one who knows it is strung; making them
    // message an admin to record that is the burden we keep removing.
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = await seedJob({ stringerId: zach.id, stringerName: 'Zach' });
    const res = await asZach(job, { status: 'strung' });
    expect(res.status).toBe(200);
    expect((await res.json()).job.status).toBe('strung');
  });

  it('REFUSES a price change', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = await seedJob({ stringerId: zach.id, stringerName: 'Zach' });
    const res = await asZach(job, { priceCents: 9900 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden_field');
  });

  it('REFUSES marking a job paid', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const job = await seedJob({ stringerId: zach.id, stringerName: 'Zach' });
    expect((await asZach(job, { paid: true })).status).toBe(403);
  });

  it('REFUSES a job assigned to somebody else', async () => {
    // A stringer is not an admin over the whole bench.
    seedMember('Zach', { id: 'member-zach', canString: true });
    const other = seedMember('Kai', { id: 'member-kai', canString: true });
    const job = await seedJob({ stringerId: other.id, stringerName: 'Kai' });
    expect((await asZach(job, { status: 'strung' })).status).toBe(401);
  });

  it('REFUSES a member who is not a stringer at all', async () => {
    seedMember('Priya', { id: 'member-priya' });
    const job = await seedJob({ stringerId: 'someone', stringerName: 'Someone' });
    const res = await PATCH(
      memberReq('PATCH', `http://x/jobs/${job.id}`, 'priya', { memberId: job.memberId, status: 'strung' }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(401);
  });
});
