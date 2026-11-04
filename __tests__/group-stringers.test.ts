import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedMember,
  seedMembership,
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';
import { PATCH as patchMember } from '@/app/api/members/route';
import { GET as listJobs } from '@/app/api/stringing/jobs/route';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import { GET as listStringersRoute } from '@/app/api/stringing/stringers/route';
import type { StringingJob } from '@/lib/types';

/**
 * Roles v2, PR 2 (docs/plans/roles-v2.md): Stringer is a BADGE held per club,
 * on the membership, like Gifter. Zach strings for BPM; joining club-x does
 * not put him on its bench until club-x's admin says so — and an ADMIN says
 * so, no organiser needed.
 *
 * Zach is seeded the way every BPM stringer exists today: `Member.canString`
 * and no membership field. BPM's unset row reads the Member (the tolerance in
 * `canStringOf`, so nobody dropped off the bench on deploy); club-x's unset
 * row reads no.
 */
const MULTI = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const before = { multi: process.env[MULTI], stringing: process.env[STRINGING] };

let zach: { id: string };
let wei: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[MULTI] = 'true';
  process.env[STRINGING] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: 'someone' });
  // The test admin is a plain ADMIN in both clubs: granting Stringer is theirs.
  seedMembership('bpm', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
  zach = seedMember('Zach', { canString: true });
  seedMembership('bpm', zach.id, { name: 'Zach', role: 'member' });
  seedMembership('club-x', zach.id, { name: 'Zachary', role: 'member' });
  wei = seedMember('Wei');
  seedMembership('club-x', wei.id, { name: 'Wei', role: 'member' });
});
afterEach(() => {
  for (const [k, v] of [[MULTI, before.multi], [STRINGING, before.stringing]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const asAdminOf = (groupId: string) => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });
const asZachIn = (groupId: string) => ({ Cookie: `member_session=${memberCookieValue('Zach', zach.id, undefined, groupId)}` });
const rowOf = (groupId: string, memberId: string) =>
  (getStore()['memberships'] as Array<{ id: string; canString?: boolean }>).find((m) => m.id === `${groupId}:${memberId}`)!;

function seedJob(groupId: string, over: Partial<StringingJob> = {}): StringingJob {
  const store = getStore();
  if (!store['stringingJobs']) store['stringingJobs'] = [];
  const now = new Date().toISOString();
  const job = {
    id: `job-${groupId}-${(store['stringingJobs'] as unknown[]).length}`,
    groupId,
    memberId: wei.id, jobNo: 'J-0001', memberName: 'Wei',
    stringerId: null, stringerName: null, status: 'received',
    racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
    method: null, priceCents: 3000, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
    createdAt: now, updatedAt: now, history: [], ...over,
  } as unknown as StringingJob;
  store['stringingJobs'].push(job);
  return job;
}

const stringersIn = async (groupId: string) => {
  const res = await listStringersRoute(makeRequest('GET', 'http://x/api/stringing/stringers', undefined, asAdminOf(groupId)));
  expect(res.status).toBe(200);
  return ((await res.json()).stringers as Array<{ name: string }>).map((s) => s.name);
};

describe('a stringer for one club is not one at another', () => {
  it('BPM\'s unset row reads the Member (nobody dropped off the bench); club-x\'s reads no', async () => {
    expect(await stringersIn('bpm')).toEqual(['Zach']);
    expect(await stringersIn('club-x')).toEqual([]);
  });

  it('the stringer view answers per cookie claim', async () => {
    const inBpm = await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asZachIn('bpm')));
    expect(await inBpm.json()).toMatchObject({ canString: true });
    const inX = await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asZachIn('club-x')));
    expect(await inX.json()).toEqual({ jobs: [], view: 'stringer', canString: false });
  });

  it('club-x cannot assign him until its admin grants the badge; then he carries club-x\'s roster name', async () => {
    const job = seedJob('club-x');
    const assign = () =>
      patchJob(makeRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, stringerId: zach.id }, asAdminOf('club-x')), {
        params: Promise.resolve({ id: job.id }),
      });
    const refused = await assign();
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('not_a_stringer');

    // An ADMIN grants it — the organiser rule is for ranks and gift cards.
    const grant = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: zach.id, canString: true }, asAdminOf('club-x')));
    expect(grant.status).toBe(200);
    expect(rowOf('club-x', zach.id).canString).toBe(true);
    expect(rowOf('bpm', zach.id).canString).toBeUndefined();
    expect(await stringersIn('club-x')).toEqual(['Zachary']);

    const ok = await assign();
    expect(ok.status).toBe(200);
    const stored = (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === job.id)!;
    expect(stored).toMatchObject({ stringerId: zach.id, stringerName: 'Zachary' });
  });

  it('a membership row that says no wins over a Member that says yes', async () => {
    rowOf('bpm', zach.id).canString = false;
    expect(await stringersIn('bpm')).toEqual([]);
    const view = await listJobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asZachIn('bpm')));
    expect((await view.json()).canString).toBe(false);
  });

  it('the stringer\'s own status write is gated per club too', async () => {
    const job = seedJob('club-x', { stringerId: zach.id, stringerName: 'Zachary' });
    const move = () =>
      patchJob(makeRequest('PATCH', `http://x/jobs/${job.id}`, { memberId: job.memberId, status: 'strung' }, asZachIn('club-x')), {
        params: Promise.resolve({ id: job.id }),
      });
    expect((await move()).status).toBe(401);
    rowOf('club-x', zach.id).canString = true;
    expect((await move()).status).toBe(200);
  });

  it('granting the badge to someone off this roster is a 404, and the Member is untouched', async () => {
    const stranger = seedMember('Stranger');
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: stranger.id, canString: true }, asAdminOf('club-x')));
    expect(res.status).toBe(404);
    expect((getStore()['members'] as Array<{ id: string; canString?: boolean }>).find((m) => m.id === stranger.id)?.canString).toBeUndefined();
  });

  it('revoking in BPM writes the membership AND the rollback copy', async () => {
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: zach.id, canString: false }, asAdminOf('bpm')));
    expect(res.status).toBe(200);
    expect(rowOf('bpm', zach.id).canString).toBe(false);
    expect((getStore()['members'] as Array<{ id: string; canString?: boolean }>).find((m) => m.id === zach.id)?.canString).toBe(false);
  });
});
