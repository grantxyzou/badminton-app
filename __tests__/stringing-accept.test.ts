import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as ACCEPT } from '../app/api/stringing/jobs/[id]/accept/route';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import { GET } from '../app/api/stringing/jobs/route';
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
 * PROPOSE → CONFIRM.
 *
 * One invariant matters more than everything else in this file: a proposed
 * price must not reach `amountDue`. `isBillable` reads `priceCents`, so as long
 * as a proposal lives only in `pendingEdit` the balance card cannot show a
 * figure nobody agreed to. If that test ever goes red, the feature is charging
 * people for a conversation.
 *
 * The other one worth its weight is the cross-member case. Authorisation here
 * is the partition key rather than a comparison, which is stronger — but the
 * mock store ignores partition keys, so only an explicit test proves it.
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
    memberId: 'member-wei',
    jobNo: 'J-0042',
    memberName: 'Wei',
    stringerId: 'member-test-admin',
    stringerName: 'Test Admin',
    status: 'ready',
    racketLabel: 'Astrox 99 Pro',
    stringLabel: 'BG80 · white',
    tensionMains: 26,
    tensionCrosses: 28,
    method: 'Zach · 2 strings, 4 knots',
    priceCents: 3000,
    readyBy: '2026-09-10',
    acceptedAt: null,
    paidAt: null,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    history: [],
    ...over,
  };
  store['stringingJobs'].push(job);
  return job;
}

const propose = (job: StringingJob, propose: Record<string, unknown>) =>
  PATCH(
    makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
      memberId: job.memberId,
      propose,
    }),
    { params: Promise.resolve({ id: job.id }) },
  );

const answer = (job: StringingJob, name: string, decision: string) =>
  ACCEPT(
    memberReq('POST', `http://x/api/stringing/jobs/${job.id}/accept`, name, { decision }),
    { params: Promise.resolve({ id: job.id }) },
  );

const stored = (id: string) =>
  (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === id)!;

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

describe('a proposed price is not a bill', () => {
  it('leaves priceCents and amountDue alone while the proposal is pending', async () => {
    // THE invariant. `ready` + priced + unpaid is billable, so this job is
    // already on somebody's balance card at $30. Proposing $34 must not move it.
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });

    expect(stored(job.id).priceCents).toBe(3000);
    expect(stored(job.id).pendingEdit?.priceCents).toBe(3400);

    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    const body = await res.json();
    expect(body.jobs[0].amountDue).toBe(30);
  });

  it('moves it only once the player accepts', async () => {
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    await answer(job, 'wei', 'accept');

    expect(stored(job.id).priceCents).toBe(3400);
    expect(stored(job.id).pendingEdit ?? null).toBeNull();
    expect(typeof stored(job.id).acceptedAt).toBe('string');

    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    expect((await res.json()).jobs[0].amountDue).toBe(34);
  });

  it('declining changes nothing except the record that they said no', async () => {
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    await answer(job, 'wei', 'decline');

    const after = stored(job.id);
    expect(after.priceCents).toBe(3000);
    expect(after.pendingEdit ?? null).toBeNull();
    expect(after.acceptedAt).toBeNull();
    expect(typeof after.pendingEditDeclinedAt).toBe('string');
  });
});

describe('only the person being asked can answer', () => {
  it('refuses another member', async () => {
    // Authorisation is the partition key, not a comparison — but the mock
    // store ignores partition keys, so this is the only thing that proves it.
    const job = await seedJob();
    await propose(job, { priceCents: 3400 });
    const res = await answer(job, 'priya', 'accept');
    expect(res.status).toBe(404);
    expect(stored(job.id).priceCents).toBe(3000);
  });

  it('refuses an anonymous caller', async () => {
    const job = await seedJob();
    await propose(job, { priceCents: 3400 });
    const res = await ACCEPT(
      makeRequest('POST', `http://x/api/stringing/jobs/${job.id}/accept`, { decision: 'accept' }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(401);
  });

  it('409s when there is nothing to answer', async () => {
    // The likely cause is a stale sheet, so the client must reload rather than
    // believe it did something.
    const job = await seedJob();
    const res = await answer(job, 'wei', 'accept');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_pending_edit');
  });

  it('rejects a decision it does not recognise', async () => {
    const job = await seedJob();
    await propose(job, { priceCents: 3400 });
    const res = await answer(job, 'wei', 'maybe');
    expect(res.status).toBe(400);
  });

  it('never returns the exact price outside the diff', async () => {
    const job = await seedJob({ status: 'received', priceCents: 3000, paidAt: null });
    await propose(job, { stringLabel: 'Aerobite' });
    const res = await answer(job, 'wei', 'accept');
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('priceCents');
    expect(raw).not.toContain('3000');
  });
});

describe('changing a price the player already knows needs their answer', () => {
  it('409s a direct price change on an already-priced job', async () => {
    const job = await seedJob({ priceCents: 3000 });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3400,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('confirm_required');
    expect(stored(job.id).priceCents).toBe(3000);
  });

  it('allows the FIRST price directly — there is nobody to confirm with yet', async () => {
    const job = await seedJob({ priceCents: null });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3000,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    expect(stored(job.id).priceCents).toBe(3000);
  });

  it('lets force through, for a genuine typo', async () => {
    const job = await seedJob({ priceCents: 3000 });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3400,
        force: true,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
  });

  it('does NOT fire on an unrelated PATCH that echoes the same price', async () => {
    // The guard is on an actual CHANGE, not on the key being present.
    // StringingJobDetail spreads its whole body, and this route has already
    // been bitten by over-eager validation once.
    const job = await seedJob({ priceCents: 3000 });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3000,
        status: 'picked_up',
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    expect(stored(job.id).status).toBe('picked_up');
  });
});

describe('a proposal only carries what actually changes', () => {
  it('drops fields identical to the job', async () => {
    // A diff listing "BG80 · white → BG80 · white" next to a real price change
    // reads as two changes and teaches people to skim.
    const job = await seedJob();
    await propose(job, { stringLabel: 'BG80 · white', priceCents: 3400 });
    const p = stored(job.id).pendingEdit!;
    expect(p.stringLabel).toBeUndefined();
    expect(p.priceCents).toBe(3400);
  });

  it('refuses a proposal that changes nothing', async () => {
    const job = await seedJob();
    const res = await propose(job, { priceCents: 3000 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_change');
  });

  it('validates tension inside a proposal', async () => {
    const job = await seedJob();
    const res = await propose(job, { tensionMains: 99 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_tension');
  });

  it('shows the player an exact from-and-to, and no stringer', async () => {
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400, tensionMains: 27 });
    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    const pe = (await res.json()).jobs[0].pendingEdit;
    expect(pe.priceFrom).toBe(30);
    expect(pe.priceTo).toBe(34);
    expect(pe.tensionFrom).toBe('26/28');
    expect(pe.tensionTo).toBe('27/28');
    expect(JSON.stringify(pe)).not.toContain('proposedBy');
    expect(JSON.stringify(pe)).not.toContain('Test Admin');
  });

  it('is absent when nothing is pending', async () => {
    await seedJob();
    const res = await GET(memberReq('GET', 'http://x/api/stringing/jobs', 'wei'));
    expect((await res.json()).jobs[0].pendingEdit).toBeNull();
  });
});

describe('a pending change does not stop the racket moving', () => {
  it('lets the bench advance while the player has not answered', async () => {
    // The racket and the invoice are two separate clocks. A status is a claim
    // about the physical world, and somebody agreeing to a price should not
    // gate the stringer picking a racket up.
    const job = await seedJob({ status: 'received', priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    const res = await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        status: 'strung',
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    expect(stored(job.id).status).toBe('strung');
    expect(stored(job.id).pendingEdit?.priceCents).toBe(3400);
  });
});

describe('archiving and a pending question cannot combine into a dead end', () => {
  it('withdraws an unanswered proposal when the job is archived', async () => {
    // A player never sees an archived job. Archiving one with a question
    // outstanding would remove the only way to answer it while the bench went
    // on claiming to be waiting — a state recoverable only by un-archiving,
    // which nobody would guess.
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    expect(stored(job.id).pendingEdit).toBeTruthy();

    await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        archived: true,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );

    const after = stored(job.id);
    expect(after.pendingEdit ?? null).toBeNull();
    // Withdrawn, not applied. A price nobody agreed to must not survive.
    expect(after.priceCents).toBe(3000);
  });

  it('leaves an already-answered job alone when archived', async () => {
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    await answer(job, 'wei', 'accept');
    await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        archived: true,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    // The accepted price stands; archiving is not an undo.
    expect(stored(job.id).priceCents).toBe(3400);
  });
});

describe('the two price mechanisms cannot drift apart', () => {
  it('a forced direct write invalidates an outstanding proposal', async () => {
    // Otherwise the older one wins: propose $34, force $35, and the player is
    // shown "$35 → $34" — a diff that reads as coherent while describing a
    // price the admin already moved past. Accepting it would silently revert
    // the $35 with no signal to anybody.
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    expect(stored(job.id).pendingEdit).toBeTruthy();

    await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3500,
        force: true,
      }),
      { params: Promise.resolve({ id: job.id }) },
    );

    const after = stored(job.id);
    expect(after.priceCents).toBe(3500);
    expect(after.pendingEdit ?? null).toBeNull();
  });

  it('leaves a proposal alone when the forced write changes nothing', async () => {
    const job = await seedJob({ priceCents: 3000 });
    await propose(job, { priceCents: 3400 });
    await PATCH(
      makeAdminRequest('PATCH', `http://x/api/stringing/jobs/${job.id}`, {
        memberId: job.memberId,
        priceCents: 3000,
        status: 'picked_up',
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(stored(job.id).pendingEdit?.priceCents).toBe(3400);
  });
});
