import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as CANCEL } from '@/app/api/stringing/jobs/[id]/cancel/route';
import { resetMockStore, getStore, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * POST /api/stringing/jobs/[id]/cancel (docs/plans/stringing-canvas-redesign.md):
 * a player calls off a request while the racket is still in their bag. Only
 * then, only their own job, and only in their own club.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

function seedJob(over: Partial<StringingJob> = {}): StringingJob {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const now = new Date().toISOString();
  const job = {
    id: `job-${Math.random().toString(16).slice(2, 10)}`,
    memberId: 'member-wei', jobNo: 'J-0042', memberName: 'Wei', stringerId: null, stringerName: null,
    status: 'requested', racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
    method: '', priceCents: null, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
    createdAt: now, updatedAt: now, history: [], groupId: 'bpm',
    ...over,
  } as StringingJob;
  store['stringingJobs'].push(job);
  return job;
}

const cancel = (job: StringingJob, name = 'Wei', memberId = 'member-wei') =>
  CANCEL(
    makeRequest('POST', `http://x/api/stringing/jobs/${job.id}/cancel`, undefined, {
      Cookie: `member_session=${memberCookieValue(name, memberId)}`,
    }),
    { params: Promise.resolve({ id: job.id }) },
  );

const stored = (id: string) => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === id)!;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('POST /api/stringing/jobs/[id]/cancel', () => {
  it('archives a REQUESTED job and stamps who called it off', async () => {
    const job = seedJob();
    const res = await cancel(job);
    expect(res.status).toBe(200);
    expect(stored(job.id).archivedAt).toBeTruthy();
    expect(stored(job.id).cancelledAt).toBeTruthy();
    // Nothing moved the status or the money.
    expect(stored(job.id).status).toBe('requested');
    expect(stored(job.id).paidAt).toBeNull();
  });

  it('refuses once the stringer has the racket', async () => {
    const job = seedJob({ status: 'received' });
    const res = await cancel(job);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_received');
    expect(stored(job.id).archivedAt).toBeUndefined();
  });

  it('refuses another member\'s job as not found', async () => {
    const job = seedJob();
    const res = await cancel(job, 'Lin', 'member-lin');
    expect(res.status).toBe(404);
    expect(stored(job.id).archivedAt).toBeUndefined();
  });

  it('refuses a job from another club', async () => {
    const job = seedJob({ groupId: 'other' } as Partial<StringingJob>);
    const res = await cancel(job);
    expect(res.status).toBe(404);
    expect(stored(job.id).archivedAt).toBeUndefined();
  });

  it('needs a member session', async () => {
    const job = seedJob();
    const res = await CANCEL(makeRequest('POST', `http://x/api/stringing/jobs/${job.id}/cancel`), { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(401);
  });
});
