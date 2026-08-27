import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, POST } from '../app/api/stringing/jobs/route';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * The bench API. Most of this file exists for ONE property: a player must never
 * receive `priceCents`.
 *
 * The design says the player "sees a range, never your exact price". That is an
 * access-control rule, not a formatting preference — so it is enforced on the
 * server and asserted on the raw JSON, the same way `deleteToken` and
 * `pinHash` are. Asserting on rendered output would pass happily while the
 * figure sat in the response body for anyone with devtools.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

function memberReq(method: string, url: string, name: string, body?: Record<string, unknown>) {
  return makeRequest(method, url, body, {
    Cookie: `member_session=${memberCookieValue(name)}`,
  });
}

async function seedJob(over: Partial<StringingJob> = {}): Promise<StringingJob> {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const now = new Date().toISOString();
  const job: StringingJob = {
    id: `job-${Math.random().toString(16).slice(2, 10)}`,
    memberId: 'member-wei',
    jobNo: 'J-0042',
    memberName: 'Wei',
    stringerId: 'member-test-admin',
    stringerName: 'Test Admin',
    status: 'received',
    racketLabel: 'Astrox 99 Pro',
    stringLabel: 'BG80 · white',
    tensionMains: 26,
    tensionCrosses: 28,
    method: 'Zach · 2 strings, 4 knots',
    priceCents: 3000,
    readyBy: '2026-08-30',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    history: [{ status: 'received', at: now, by: 'member-test-admin' }],
    ...over,
  };
  store['stringingJobs'].push(job);
  return job;
}

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

describe('the exact price never reaches a player', () => {
  it('strips priceCents and sends a band instead', async () => {
    await seedJob({ priceCents: 3000 });
    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.view).toBe('player');
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].priceRange).toBe('$28–32');

    // Asserted on the SERIALISED body, not on a typed view: the failure this
    // guards against is the figure riding along in JSON while the UI shows a
    // range, which a shape-only assertion would miss.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('priceCents');
    expect(raw).not.toContain('3000');
  });

  it('hides the stringer and the bench status word too', async () => {
    await seedJob({ status: 'ready', stringerName: 'Test Admin' });
    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('stringerId');
    expect(raw).not.toContain('Test Admin');
    // The bench's word for it, absent; the player's word for it, present.
    expect(raw).not.toContain('"status"');
    expect(raw).toContain('ready_for_you');
  });

  it('gives the admin the exact figure', async () => {
    await seedJob({ priceCents: 3000 });
    const res = await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs'));
    const body = await res.json();
    expect(body.view).toBe('bench');
    expect(body.jobs[0].priceCents).toBe(3000);
  });
});

describe('a player only sees their own jobs', () => {
  it('never returns another member’s job', async () => {
    await seedJob({ memberId: 'member-wei', memberName: 'Wei' });
    await seedJob({ memberId: 'member-priya', memberName: 'Priya', jobNo: 'J-0043' });

    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('J-0043');
  });

  it('refuses an anonymous caller outright', async () => {
    await seedJob();
    const res = await GET(makeRequest('GET', 'http://x/api/stringing/jobs'));
    expect(res.status).toBe(401);
  });
});

describe('the bench', () => {
  it('filters to the caller’s own jobs with ?mine=true', async () => {
    await seedJob({ stringerId: 'member-test-admin', jobNo: 'J-0001' });
    await seedJob({ stringerId: 'member-someone-else', jobNo: 'J-0002' });

    const all = await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs'));
    expect((await all.json()).jobs).toHaveLength(2);

    const mine = await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs?mine=true'));
    const mineBody = await mine.json();
    expect(mineBody.jobs).toHaveLength(1);
    expect(mineBody.jobs[0].jobNo).toBe('J-0001');
  });

  it('creates a job and claims it for whoever logged it', async () => {
    const res = await POST(
      makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
        memberId: 'member-wei',
        memberName: 'Wei',
        racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80 · white',
        tensionMains: 26,
        tensionCrosses: 28,
        priceCents: 3000,
      }),
    );
    expect(res.status).toBe(201);
    const { job } = await res.json();
    expect(job.stringerId).toBe('member-test-admin');
    expect(job.status).toBe('received');
    expect(job.history).toHaveLength(1);
    // The doc id is random; only the printed number is sequential.
    expect(job.id).not.toBe(job.jobNo);
    expect(job.jobNo).toMatch(/^J-\d{4,}$/);
  });

  it('numbers jobs sequentially, and keeps the id unguessable', async () => {
    // Two things at once, because they pull in opposite directions: the NUMBER
    // has to be predictable enough to say out loud, and the ID has to not be.
    await seedJob({ jobNo: 'J-0001' });
    const res = await POST(
      makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
        memberId: 'member-priya',
        memberName: 'Priya',
        racketLabel: 'Nanoflare 800',
        stringLabel: 'Aerobite',
        tensionMains: 24,
        tensionCrosses: 26,
      }),
    );
    const { job } = await res.json();
    expect(job.jobNo).toBe('J-0002');
    expect(job.id).toMatch(/^job-[0-9a-f]{16}$/);
  });

  it('refuses a player trying to log a job', async () => {
    const res = await POST(
      memberReq('POST', 'http://x/api/stringing/jobs', 'wei', {
        memberId: 'member-wei',
        memberName: 'Wei',
        racketLabel: 'X',
        stringLabel: 'Y',
        tensionMains: 26,
        tensionCrosses: 28,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('rejects a tension a machine cannot hold', async () => {
    const res = await POST(
      makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
        memberId: 'member-wei',
        memberName: 'Wei',
        racketLabel: 'X',
        stringLabel: 'Y',
        tensionMains: 45,
        tensionCrosses: 28,
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_tension');
  });
});

describe('moving a job along', () => {
  it('appends to history only when the status actually changed', async () => {
    const job = await seedJob({ status: 'received' });
    const url = `http://x/api/stringing/jobs/${job.id}`;

    const moved = await PATCH(
      makeAdminRequest('PATCH', url, { memberId: job.memberId, status: 'strung' }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect((await moved.json()).job.history).toHaveLength(2);

    // Re-tapping the current step is a no-op. Otherwise the audit trail fills
    // with noise and stops being readable as the record of what happened.
    const again = await PATCH(
      makeAdminRequest('PATCH', url, { memberId: job.memberId, status: 'strung' }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect((await again.json()).job.history).toHaveLength(2);
  });

  it('allows a correction backwards, because the bench does', async () => {
    const job = await seedJob({ status: 'ready' });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        status: 'received',
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    const { job: updated } = await res.json();
    expect(updated.status).toBe('received');
    // The correction is visible rather than silent — that is what makes a
    // permissive transition rule safe.
    expect(updated.history.at(-1)).toMatchObject({ status: 'received' });
  });

  it('records WHEN something was paid, not merely that it was', async () => {
    const job = await seedJob();
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        paid: true,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    const { job: updated } = await res.json();
    expect(typeof updated.paidAt).toBe('string');
  });

  it('refuses a player', async () => {
    const job = await seedJob();
    const res = await PATCH(
      memberReq('PATCH', `http://x/api/stringing/jobs/${job.id}`, 'wei', {
        memberId: job.memberId,
        status: 'picked_up',
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(401);
  });
});

describe('the flag gates the server, not just the UI', () => {
  it('404s every verb when off', async () => {
    process.env[FLAG] = 'false';
    const job = await seedJob();
    const get = await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs'));
    const post = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', {}));
    const patch = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect([get.status, post.status, patch.status]).toEqual([404, 404, 404]);
  });
});
