import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
} from './helpers';
import type { StringingJob } from '../lib/types';

/**
 * Two things the bench PATCH says to people, and when (final review of the
 * 2026-10-11 audit branch).
 *
 * 1. The PLAYER is told about a stage only on a FORWARD move. An undo or a
 *    correction (`ready` → `strung`, `picked_up` → `ready`) used to send
 *    "being strung" right after "ready", or "your racket is ready" to someone
 *    holding it. A backward move is a bookkeeping correction, not news.
 *
 * 2. A STRINGER is told when a job is ASSIGNED to them — that is the moment a
 *    request becomes something they can act on (their card only ever shows
 *    jobs assigned to them). Not when they assign it to themselves.
 */
type Payload = { title: string; body: string; url?: string; tag?: string };
const notifyPlayerOfStage = vi.fn(async (_job: StringingJob) => ({ attempted: true, emailSent: false, pushSent: 0 }));
const notifyPlayerOfPendingEdit = vi.fn(async (_job: StringingJob) => ({ attempted: true, emailSent: false, pushSent: 0 }));
vi.mock('@/lib/stringingNotifyDispatch', () => ({
  notifyPlayerOfStage: (job: StringingJob) => notifyPlayerOfStage(job),
  notifyPlayerOfPendingEdit: (job: StringingJob) => notifyPlayerOfPendingEdit(job),
}));
const sendPushToMembers = vi.fn(async (_ids: string[], _p: Payload) => ({ configured: true, sent: 1, failed: 0, removed: 0 }));
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (ids: string[], p: Payload) => sendPushToMembers(ids, p),
  sendPushToAll: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

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
  PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, ...body }), {
    params: Promise.resolve({ id: job.id }),
  });

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
  notifyPlayerOfStage.mockClear();
  notifyPlayerOfPendingEdit.mockClear();
  sendPushToMembers.mockClear();
  getStore().members.push({ id: 'm-zach', name: 'Zach', role: 'member', active: true, canString: true, createdAt: new Date().toISOString() });
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('the player hears about forward moves only', () => {
  it('tells the player when the racket moves forward', async () => {
    const job = await seedJob({ status: 'strung' });
    expect((await patch(job, { status: 'ready' })).status).toBe(200);
    expect(notifyPlayerOfStage).toHaveBeenCalledTimes(1);
    expect(notifyPlayerOfStage.mock.calls[0][0].status).toBe('ready');
  });

  it('says nothing on an undo or a correction backwards', async () => {
    const back = await seedJob({ status: 'ready' });
    expect((await patch(back, { status: 'strung' })).status).toBe(200);
    const fromPickedUp = await seedJob({ status: 'picked_up' });
    expect((await patch(fromPickedUp, { status: 'ready' })).status).toBe(200);
    expect(notifyPlayerOfStage).not.toHaveBeenCalled();
  });

  it('still records the backward move in the history', async () => {
    const job = await seedJob({ status: 'ready' });
    const res = await patch(job, { status: 'strung' });
    const { job: written } = (await res.json()) as { job: StringingJob };
    expect(written.status).toBe('strung');
    expect(written.history.at(-1)?.status).toBe('strung');
  });
});

describe('a stringer hears when a job is assigned to them', () => {
  it('pushes the assignee, with the spec kept off the lock screen, opening the Stringing tab', async () => {
    const job = await seedJob();
    expect((await patch(job, { stringerId: 'm-zach' })).status).toBe(200);
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    const [ids, payload] = sendPushToMembers.mock.calls[0];
    expect(ids).toEqual(['m-zach']);
    expect(payload.body).toContain('Astrox 99 Pro');
    expect(payload.body).toContain('Wei');
    expect(payload.body).not.toMatch(/\$|lb|BG80|26/);
    expect(payload.url).toMatch(/tab=stringing/);
  });

  it('does not push on a re-save of the same assignee, on unassign, or on a self-claim', async () => {
    const job = await seedJob({ stringerId: 'm-zach', stringerName: 'Zach' });
    await patch(job, { stringerId: 'm-zach' });
    await patch(job, { stringerId: null });
    await patch(job, { claim: true });
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });
});
