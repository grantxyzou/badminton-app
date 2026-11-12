import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return { ...real, sendPushToMembers: vi.fn(async () => ({ configured: true, sent: 1, failed: 0, removed: 0 })) };
});

import {
  resetMockStore,
  setupAdminPin,
  getStore,
  seedGroup,
  seedMember,
  seedMembership,
  makeRequest,
  memberCookieValue,
} from './helpers';
import { sendPushToMembers } from '@/lib/push';
import { runStringingNudges } from '@/lib/stringingNudge';
import { nudgesDue, isWaitingTooLong, waitingDays } from '@/lib/stringingWaiting';
import { buildRequestWaitingPayload } from '@/lib/pushMessages';
import { POST as tick } from '@/app/api/cron/tick/route';
import { GET as listJobs } from '@/app/api/stringing/jobs/route';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import type { StringingJob } from '@/lib/types';

/**
 * A stringing request nobody answers nudges the stringers
 * (docs/plans/stringing-request-nudge.md). Two clubs: club-x has an organiser,
 * a stringer (Zach), a plain admin and the player (Wei); BPM has its own
 * stringer (Bo), who must never hear about club-x's rackets.
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const H = 3_600_000;
const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const KEY = 'a-long-enough-cron-key-for-tests';

const send = vi.mocked(sendPushToMembers);

let org: { id: string }, zach: { id: string }, ada: { id: string }, wei: { id: string }, bo: { id: string }, kai: { id: string };

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  send.mockClear();
  process.env[MULTI] = 'true';
  process.env[STRINGING] = 'true';
  org = seedMember('Organiser');
  zach = seedMember('Zach');
  ada = seedMember('Ada');
  wei = seedMember('Wei');
  bo = seedMember('Bo');
  kai = seedMember('Kai');
  seedGroup('club-x', { ownerMemberId: org.id });
  seedGroup('bpm', { ownerMemberId: bo.id });
  seedMembership('club-x', org.id, { name: 'Organiser', role: 'owner' });
  seedMembership('club-x', zach.id, { name: 'Zach', canString: true });
  seedMembership('club-x', kai.id, { name: 'Kai', canString: true });
  seedMembership('club-x', ada.id, { name: 'Ada', role: 'admin' });
  seedMembership('club-x', wei.id, { name: 'Wei' });
  seedMembership('bpm', bo.id, { name: 'Bo', role: 'owner', canString: true });
});
afterEach(() => {
  delete process.env[MULTI];
  delete process.env[STRINGING];
  delete process.env.CRON_KEY;
});

function seedJob(groupId: string, over: Partial<StringingJob> = {}): StringingJob {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const createdAt = new Date(NOW - 49 * H).toISOString();
  const job = {
    id: `job-${groupId}-${(store['stringingJobs'] as unknown[]).length}`,
    groupId,
    memberId: wei.id, jobNo: 'J-0007', memberName: 'Wei',
    stringerId: null, stringerName: null, status: 'requested',
    racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 26,
    method: '', priceCents: 3000, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
    createdAt, updatedAt: createdAt, history: [{ status: 'requested', at: createdAt, by: wei.id }],
    ...over,
  } as StringingJob;
  (store['stringingJobs'] as unknown[]).push(job);
  return job;
}
const stored = (id: string) => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === id)!;
const pushedTo = () => send.mock.calls.flatMap(([ids]) => ids as string[]).sort();

describe('the waiting rule', () => {
  it('nudges at 48 hours and 3 days, only while the job is still requested', () => {
    const at = (h: number, status = 'requested') => ({ status, createdAt: new Date(NOW - h * H).toISOString() }) as StringingJob;
    expect(nudgesDue(at(47), NOW)).toBe(0);
    expect(nudgesDue(at(48), NOW)).toBe(1);
    expect(nudgesDue(at(72), NOW)).toBe(2);
    expect(nudgesDue(at(200), NOW)).toBe(2);
    expect(nudgesDue(at(100, 'received'), NOW)).toBe(0);
    expect(isWaitingTooLong(at(49), NOW)).toBe(true);
    expect(waitingDays(at(73), NOW)).toBe(3);
  });

  it('the push names the player, the racket and the wait, with no money and no spec', () => {
    const p = buildRequestWaitingPayload({ jobNo: 'J-0007', memberName: 'Wei', racketLabel: 'Astrox 88D Pro' }, 2, 'stringing');
    expect(p.body).toBe("Wei's Astrox 88D Pro has waited 2 days for a stringer.");
    expect(p.url).toMatch(/\?tab=stringing$/);
    expect(`${p.title} ${p.body}`).not.toMatch(/\$|BG80|26/);
  });
});

describe('the nudge job', () => {
  it('an unclaimed request at 48 hours reaches this club’s stringers and organisers, once', async () => {
    const job = seedJob('club-x');
    const result = await runStringingNudges('club-x', NOW);
    expect(result).toMatchObject({ waiting: 1, nudged: 1, recipients: 3 });
    // Organiser and both stringers; not the plain admin, not the player, not BPM's Bo.
    expect(pushedTo()).toEqual([kai.id, org.id, zach.id].sort());
    expect(stored(job.id).requestNudgedAt).toHaveLength(1);
    // The organiser opens the bench; a stringer who is not an admin opens their card.
    const byScreen = Object.fromEntries(
      send.mock.calls.map(([ids, build]) => [
        (build as (l: 'en') => { url: string })('en').url.split('tab=')[1],
        [...(ids as string[])].sort(),
      ]),
    );
    expect(byScreen).toEqual({ admin: [org.id], stringing: [kai.id, zach.id].sort() });

    send.mockClear();
    await runStringingNudges('club-x', NOW + H);
    expect(send).not.toHaveBeenCalled();
  });

  it('nudges again at 3 days, then stops', async () => {
    const job = seedJob('club-x');
    await runStringingNudges('club-x', NOW);
    send.mockClear();
    await runStringingNudges('club-x', NOW + 24 * H);
    expect(send).toHaveBeenCalled();
    expect(stored(job.id).requestNudgedAt).toHaveLength(2);
    send.mockClear();
    await runStringingNudges('club-x', NOW + 96 * H);
    expect(send).not.toHaveBeenCalled();
  });

  it('a tick that missed both marks sends ONE push and stamps both', async () => {
    const job = seedJob('club-x', { createdAt: new Date(NOW - 80 * H).toISOString() });
    await runStringingNudges('club-x', NOW);
    expect(send).toHaveBeenCalledTimes(2); // one per destination screen, one push each person
    expect(new Set(pushedTo()).size).toBe(pushedTo().length);
    expect(stored(job.id).requestNudgedAt).toHaveLength(2);
  });

  it('an assigned request still at requested nudges only its stringer', async () => {
    seedJob('club-x', { stringerId: zach.id, stringerName: 'Zach' });
    await runStringingNudges('club-x', NOW);
    expect(pushedTo()).toEqual([zach.id]);
  });

  it('leaves alone a job moved on, archived, cancelled or younger than 48 hours', async () => {
    seedJob('club-x', { status: 'received' });
    seedJob('club-x', { archivedAt: new Date(NOW).toISOString() });
    seedJob('club-x', { cancelledAt: new Date(NOW).toISOString() });
    seedJob('club-x', { createdAt: new Date(NOW - 47 * H).toISOString() });
    const result = await runStringingNudges('club-x', NOW);
    expect(result.nudged).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('never reaches across clubs: BPM’s run does not see club-x’s request', async () => {
    seedJob('club-x');
    const result = await runStringingNudges('bpm', NOW);
    expect(result.waiting).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/tick', () => {
  let ip = 0;
  const call = (key?: string) =>
    tick(makeRequest('POST', 'http://x/api/cron/tick', undefined, {
      'X-Client-IP': `10.9.0.${++ip}`,
      ...(key ? { 'x-cron-key': key } : {}),
    }));

  it('answers 503 while CRON_KEY is unset, 401 to a wrong key', async () => {
    expect((await call(KEY)).status).toBe(503);
    process.env.CRON_KEY = KEY;
    expect((await call('wrong-key-of-some-length')).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  it('runs the nudge for every open club and answers with counts only', async () => {
    process.env.CRON_KEY = KEY;
    seedGroup('closed-club', { ownerMemberId: 'x', closedAt: '2026-10-01T00:00:00.000Z' });
    seedJob('club-x', { createdAt: new Date(Date.now() - 49 * H).toISOString() });
    const res = await call(KEY);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, clubs: 2, jobs: { stringingNudge: { ok: 2, failed: 0, totals: { nudged: 1 } } } });
    expect(JSON.stringify(body)).not.toMatch(/Wei|Astrox|J-0007/);
  });
});

describe('a stringer takes an unclaimed request', () => {
  const asMember = (name: string, id: string) => ({ Cookie: `member_session=${memberCookieValue(name, id, undefined, 'club-x')}` });
  const take = (job: StringingJob, name: string, id: string, extra: Record<string, unknown> = {}) =>
    patchJob(
      makeRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, { memberId: job.memberId, claim: true, ...extra }, asMember(name, id)),
      { params: Promise.resolve({ id: job.id }) },
    );

  it('sees it on their card, with no money', async () => {
    seedJob('club-x');
    seedJob('club-x', { stringerId: kai.id, stringerName: 'Kai' });
    const res = await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asMember('Zach', zach.id)));
    const body = await res.json();
    expect(body.unclaimed).toHaveLength(1);
    expect(body.unclaimed[0]).not.toHaveProperty('priceCents');
    expect(body.jobs).toHaveLength(0);
  });

  it('takes it for themselves; the second stringer is told it is gone', async () => {
    const job = seedJob('club-x');
    const first = await take(job, 'Zach', zach.id);
    expect(first.status).toBe(200);
    expect(stored(job.id)).toMatchObject({ stringerId: zach.id, stringerName: 'Zach' });
    expect(stored(job.id).claimedAt).toBeTruthy();
    const second = await take(job, 'Kai', kai.id);
    expect(second.status).toBe(409);
    expect(stored(job.id).stringerId).toBe(zach.id);
  });

  it('may not take a job with anything else in the body, and a non-stringer may not take one at all', async () => {
    const job = seedJob('club-x');
    expect((await take(job, 'Zach', zach.id, { priceCents: 0 })).status).toBe(403);
    expect((await take(job, 'Wei', wei.id)).status).toBe(401);
    expect(stored(job.id).stringerId).toBeNull();
  });
});
