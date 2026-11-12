import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET, POST, toPlayerJob, toStringerJob } from '../app/api/stringing/jobs/route';
import { PATCH } from '../app/api/stringing/jobs/[id]/route';
import { GET as stockGet, POST as stockPost } from '../app/api/stringing/stock/route';
import { PATCH as stringsPatch } from '../app/api/stringing/strings/route';
import { notifyPlayerOfStage, notifyPlayerOfPendingEdit } from '../lib/stringingNotifyDispatch';
import { runReconcile } from '../lib/ledgerReconcile';
import { computeOwed, computeOwedForRoster } from '../lib/owedBalance';
import { resolveIdentity } from '../lib/playerIdentity';
import { groupScope } from '../lib/groupScope';
import { purgeMember } from '../lib/memberPurge';
import { buildAssignmentPayload, buildRequestWaitingPayload } from '../lib/pushMessages';
import { isWalkUpJob, WALK_UP_ID_PREFIX } from '../lib/stringing';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';
import type { LedgerEntry, StringingJob } from '../lib/types';

/**
 * Walk-ups (docs/plans/stringing-walk-ups.md; Grant, 2026-11-12: "give me the
 * ability to add a job for people thats not in the roster").
 *
 * A walk-up's job lives under a synthetic `~walkup:<hex>` partition key the
 * SERVER mints. Everything below checks one property of that: nobody but the
 * admins and the job's stringer ever reads it as a person, no money of it
 * lands on a member, the ledger checks stay quiet, and nothing is sent to it.
 */
const FLAGS = ['NEXT_PUBLIC_FLAG_STRINGING', 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_MULTI_GROUP'] as const;
const before = Object.fromEntries(FLAGS.map((f) => [f, process.env[f]]));

const jobs = () => (getStore()['stringingJobs'] ?? []) as StringingJob[];
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
/** Notifications-page records live in `insights` (lib/notices.ts). */
const notices = () => ((getStore()['insights'] ?? []) as { kind?: string }[]).filter((d) => d.kind === 'notice');

const WALK_UP_BODY = {
  walkUp: true,
  memberName: '  Lee  ',
  walkUpContact: '  604-555-0199  ',
  racketLabel: 'Astrox 88D Pro',
  stringLabel: 'BG80',
  tensionMains: 26,
  tensionCrosses: 28,
  priceCents: 3000,
};

async function createWalkUp(over: Record<string, unknown> = {}) {
  const res = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', { ...WALK_UP_BODY, ...over }));
  return { res, body: await res.json() };
}

const patch = (job: Pick<StringingJob, 'id' | 'memberId'>, body: Record<string, unknown>) =>
  PATCH(makeAdminRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, ...body }), {
    params: Promise.resolve({ id: job.id }),
  });

function memberReq(method: string, url: string, name: string, memberId?: string) {
  return makeRequest(method, url, undefined, { Cookie: `member_session=${memberCookieValue(name, memberId)}` });
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  await seedTestAdminMember();
});
afterEach(() => {
  for (const f of FLAGS) {
    if (before[f] === undefined) delete process.env[f];
    else process.env[f] = before[f];
  }
  vi.restoreAllMocks();
});

describe('creating a walk-up job', () => {
  it('mints its own partition key, keeps the typed name, and trims the contact', async () => {
    const { res, body } = await createWalkUp({ memberId: 'member-wei' });
    expect(res.status).toBe(201);
    const { job } = body;
    // Never the id the client sent: a client-chosen id could be a member's
    // (their balance) or a ledger sentinel.
    expect(job.memberId).not.toBe('member-wei');
    expect(job.memberId).toMatch(/^~walkup:[0-9a-f]{16}$/);
    expect(job.walkUp).toBe(true);
    expect(job.memberName).toBe('Lee');
    expect(job.walkUpContact).toBe('604-555-0199');
    expect(job.status).toBe('received');
    expect(job.stringerId).toBe('member-test-admin');
    // Stamped with the club like any job, through groupScope.
    expect(jobs()[0].groupId).toBe('bpm');
    expect(isWalkUpJob(job)).toBe(true);
  });

  it('gives each walk-up job its own partition, and keeps counting job numbers', async () => {
    const a = (await createWalkUp()).body.job;
    const b = (await createWalkUp({ memberName: 'Lee' })).body.job;
    expect(a.memberId).not.toBe(b.memberId);
    expect([a.jobNo, b.jobNo]).toEqual(['J-0001', 'J-0002']);
  });

  it('stores no contact when none is typed', async () => {
    const { body } = await createWalkUp({ walkUpContact: '   ' });
    expect(body.job).not.toHaveProperty('walkUpContact');
    const { body: b2 } = await createWalkUp({ walkUpContact: null });
    expect(b2.job).not.toHaveProperty('walkUpContact');
  });

  it('refuses a contact that is too long or not text, and a missing or long name', async () => {
    expect((await createWalkUp({ walkUpContact: 'x'.repeat(121) })).body.error).toBe('invalid_contact');
    expect((await createWalkUp({ walkUpContact: 6045550199 })).body.error).toBe('invalid_contact');
    expect((await createWalkUp({ memberName: '' })).res.status).toBe(400);
    expect((await createWalkUp({ memberName: 'x'.repeat(51) })).res.status).toBe(400);
    expect(jobs()).toHaveLength(0);
  });

  it('is an admin’s only: a member cannot log one', async () => {
    seedMember('Wei', { id: 'member-wei' });
    const res = await POST(
      makeRequest('POST', 'http://x/api/stringing/jobs', WALK_UP_BODY, {
        Cookie: `member_session=${memberCookieValue('Wei', 'member-wei')}`,
      }),
    );
    expect(res.status).toBe(401);
    expect(jobs()).toHaveLength(0);
  });

  it('refuses a MEMBER job whose id is a sentinel, so a forged `~` id cannot reach the bench', async () => {
    for (const memberId of ['~club', '~walkup:abc', '~anon']) {
      const res = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', { ...WALK_UP_BODY, walkUp: undefined, memberId, memberName: 'X' }));
      expect(res.status).toBe(400);
    }
    expect(jobs()).toHaveLength(0);
  });

  it('with groups on, skips the roster check that still refuses a member job for a stranger', async () => {
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    const walkUp = await createWalkUp();
    expect(walkUp.res.status).toBe(201);
    expect(jobs()[0].groupId).toBe('bpm');

    const stranger = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', {
      ...WALK_UP_BODY, walkUp: undefined, memberId: 'member-nobody', memberName: 'Nobody',
    }));
    expect(stranger.status).toBe(404);
    expect((await stranger.json()).error).toBe('not_on_roster');
  });
});

describe('who can read a walk-up job', () => {
  it('admins get the whole job on the bench, contact included', async () => {
    await createWalkUp();
    const body = await (await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs'))).json();
    expect(body.view).toBe('bench');
    expect(body.jobs[0].walkUpContact).toBe('604-555-0199');
  });

  it('no player ever sees it: the player list is keyed by the caller’s own id', async () => {
    seedMember('Wei', { id: 'member-wei' });
    await createWalkUp();
    const wei = await (await GET(memberReq('GET', 'http://x/api/stringing/jobs?view=player', 'Wei', 'member-wei'))).json();
    expect(wei.view).toBe('player');
    expect(wei.jobs).toEqual([]);
    // The admin's own player view too.
    const admin = await (await GET(makeAdminRequest('GET', 'http://x/api/stringing/jobs?view=player'))).json();
    expect(admin.jobs).toEqual([]);
  });

  it('the player projection names neither the flag nor the contact', async () => {
    const { body } = await createWalkUp();
    const raw = JSON.stringify(toPlayerJob(body.job));
    expect(raw).not.toContain('604-555-0199');
    expect(raw).not.toContain('walkUp');
  });

  it('the assigned stringer gets the contact on their queue; the open list every stringer sees does not', async () => {
    const zach = seedMember('Zach', { id: 'member-zach', canString: true });
    const mine = (await createWalkUp()).body.job;
    await patch(mine, { stringerId: zach.id });
    // A walk-up at `requested` with nobody on it: on every stringer's open list.
    const open = (await createWalkUp({ status: 'requested', walkUpContact: 'lee@example.com' })).body.job;
    await patch(open, { stringerId: null });

    const body = await (await GET(memberReq('GET', 'http://x/api/stringing/jobs?view=stringer', 'Zach', zach.id))).json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]).toMatchObject({ walkUp: true, walkUpContact: '604-555-0199' });
    expect(body.unclaimed).toHaveLength(1);
    expect(body.unclaimed[0].walkUp).toBe(true);
    expect(body.unclaimed[0]).not.toHaveProperty('walkUpContact');
    expect(JSON.stringify(body.unclaimed)).not.toContain('lee@example.com');
    // And no money, walk-up or not.
    expect(JSON.stringify(body)).not.toContain('priceCents');
  });

  it('toStringerJob carries the contact only when asked, and only for a walk-up', () => {
    const job = { ...jobsBase(), walkUp: true, walkUpContact: '604' } as StringingJob;
    expect(toStringerJob(job)).not.toHaveProperty('walkUpContact');
    expect(toStringerJob(job, { contact: true }).walkUpContact).toBe('604');
    // A member's job carrying a stray field still sends nothing.
    const member = { ...jobsBase(), walkUpContact: '604' } as StringingJob;
    expect(toStringerJob(member, { contact: true })).not.toHaveProperty('walkUpContact');
    expect(toStringerJob(member)).not.toHaveProperty('walkUp');
  });
});

function jobsBase(): StringingJob {
  const now = '2026-11-12T10:00:00.000Z';
  return {
    id: 'job-x', memberId: `${WALK_UP_ID_PREFIX}0011223344556677`, jobNo: 'J-0009', memberName: 'Lee',
    stringerId: null, stringerName: null, status: 'received', racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80',
    tensionMains: 26, tensionCrosses: 28, method: 'm', priceCents: 3000, readyBy: null, acceptedAt: null,
    paidAt: null, sessionId: null, createdAt: now, updatedAt: now, history: [],
  };
}

describe('nothing is sent to a walk-up', () => {
  it('the stage notice answers before reading or writing anything', async () => {
    const { body } = await createWalkUp();
    const job = { ...body.job, status: 'ready' } as StringingJob;
    const out = await notifyPlayerOfStage(job);
    expect(out).toEqual({ attempted: false, emailSent: false, pushSent: 0, reason: 'walk_up' });
    // No Notifications-page record for a person who does not exist.
    expect(notices()).toHaveLength(0);
  });

  it('the pending-edit notice too', async () => {
    const { body } = await createWalkUp();
    const out = await notifyPlayerOfPendingEdit({ ...body.job, pendingEdit: { proposedAt: 'x', proposedBy: null, priceCents: 3400 } });
    expect(out.reason).toBe('walk_up');
    expect(notices()).toHaveLength(0);
  });

  it('moving it to ready through the bench sends nothing and still answers 200', async () => {
    const push = await import('../lib/push');
    const spy = vi.spyOn(push, 'sendPushToMembers');
    const { body } = await createWalkUp();
    const res = await patch(body.job, { status: 'ready' });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a stringer push may name the walk-up, never their contact', async () => {
    const job = { ...jobsBase(), walkUp: true, walkUpContact: '604-555-0199', stringerId: 'member-zach' } as StringingJob;
    const raw = JSON.stringify([buildAssignmentPayload(job, 'en'), buildRequestWaitingPayload(job, 2, 'stringing', 'en')]);
    expect(raw).toContain('Lee');
    expect(raw).not.toContain('604-555-0199');
  });
});

describe('a change to a walk-up job applies at once', () => {
  it('a proposal is written straight onto the job, with nothing left waiting', async () => {
    const { body } = await createWalkUp();
    const res = await patch(body.job, { propose: { priceCents: 3400, stringLabel: 'BG66', tensionMains: 27, reason: 'Agreed at the desk.' } });
    expect(res.status).toBe(200);
    const { job } = await res.json();
    expect(job).toMatchObject({ priceCents: 3400, stringLabel: 'BG66', tensionMains: 27, tensionCrosses: 28, pendingEdit: null });
    expect(jobs()[0].priceCents).toBe(3400);
    expect(jobs()[0].pendingEdit).toBeNull();
  });

  it('a direct re-price needs no `force`', async () => {
    const { body } = await createWalkUp();
    const res = await patch(body.job, { priceCents: 3200 });
    expect(res.status).toBe(200);
    expect(jobs()[0].priceCents).toBe(3200);
  });

  it('a paid walk-up job still cannot be re-priced', async () => {
    const { body } = await createWalkUp({ status: 'ready' });
    await patch(body.job, { paid: true });
    expect((await patch(body.job, { priceCents: 3200 })).status).toBe(409);
    expect((await patch(body.job, { propose: { priceCents: 3200 } })).status).toBe(409);
    expect(jobs()[0].priceCents).toBe(3000);
  });

  it('a member’s job still asks first', async () => {
    seedMember('Wei', { id: 'member-wei' });
    const res = await POST(makeAdminRequest('POST', 'http://x/api/stringing/jobs', { ...WALK_UP_BODY, walkUp: undefined, memberId: 'member-wei', memberName: 'Wei' }));
    const { job } = await res.json();
    expect((await patch(job, { priceCents: 3200 })).status).toBe(409);
    const proposed = await (await patch(job, { propose: { priceCents: 3200 } })).json();
    expect(proposed.job.priceCents).toBe(3000);
    expect(proposed.job.pendingEdit.priceCents).toBe(3200);
  });
});

describe('money: paid at pickup, on nobody’s balance, and the reconcile stays quiet', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  });

  it('never appears on any member’s balance, Home’s or the roster’s', async () => {
    const wei = seedMember('Wei', { id: 'member-wei' });
    const { body } = await createWalkUp();
    await patch(body.job, { status: 'ready' });
    const scope = groupScope('bpm');
    for (const name of ['Wei', 'Test Admin']) {
      const owed = await computeOwed(scope, await resolveIdentity({ name }, 'bpm'));
      expect(owed.stringing).toEqual([]);
    }
    const roster = await computeOwedForRoster(scope);
    expect(roster.some((r) => r.balance.stringing.length > 0)).toBe(false);
    expect(roster.some((r) => r.memberId === wei.id)).toBe(true);
  });

  it('mirrors the charge under its own partition, counts as unlisted while owed, and nets to zero once paid', async () => {
    const { body } = await createWalkUp();
    await patch(body.job, { status: 'ready' });
    const charge = ledger().find((e) => e.kind === 'charge' && e.ref?.id === body.job.id)!;
    expect(charge).toBeDefined();
    expect(charge.memberId).toBe(body.job.memberId);
    expect(charge.amountCents).toBe(3000);

    const owing = await runReconcile('bpm');
    expect(owing.mismatches).toEqual([]);
    expect(owing.unlisted).toBe(1);

    // "Mark paid" at pickup: the club's income counts it, the line closes.
    await patch(body.job, { paid: true });
    const payment = ledger().find((e) => e.kind === 'payment' && e.ref?.id === body.job.id)!;
    expect(payment.amountCents).toBe(-3000);
    const paid = await runReconcile('bpm');
    expect(paid.mismatches).toEqual([]);
    expect(paid.unlisted).toBe(0);
  });

  it('account deletion refuses the synthetic id, as it refuses every sentinel', async () => {
    const { body } = await createWalkUp();
    await expect(purgeMember(body.job.memberId, 'Lee')).rejects.toThrow(/not a member/);
    expect(jobs()).toHaveLength(1);
  });
});

describe('stock: a strung walk-up job used a set like any other', () => {
  it('counts against the reel', async () => {
    await stringsPatch(makeAdminRequest('PATCH', 'http://x/api/stringing/strings', { strings: ['BG80'] }));
    const bought = await stockPost(makeAdminRequest('POST', 'http://x/api/stringing/stock', { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, date: '2026-11-01' }));
    expect(bought.status).toBe(201);
    const read = async () => (await (await stockGet(makeAdminRequest('GET', 'http://x/api/stringing/stock'))).json());
    const line = (b: { lines?: { label: string; usedSets: number; remainingSets: number }[] }) => b.lines?.find((l) => l.label === 'BG80');
    const { body } = await createWalkUp();
    // Received: the racket is on the bench, nothing is strung yet.
    expect(line(await read())).toMatchObject({ usedSets: 0, remainingSets: 20 });

    await patch(body.job, { status: 'strung' });
    expect(line(await read())).toMatchObject({ usedSets: 1, remainingSets: 19 });
  });
});
