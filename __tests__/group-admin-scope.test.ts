import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  makeRequest,
  memberCookieValue,
  adminCookieValue,
  getTestAdminName,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { isAdminAuthed, isAdminAuthedWithMember } from '@/lib/auth';
import { PATCH as patchMember, DELETE as deleteMember } from '@/app/api/members/route';
import { POST as resetAccess } from '@/app/api/players/reset-access/route';

/**
 * An admin acts on THEIR club and nobody else's (security review, 2026-10-24).
 *
 * With groups on, any signed-in member can create a club and come away holding
 * an `admin_session` for it. Two holes followed:
 *   1. The admin token names one club, `resolveGroupId` reads the MEMBER token
 *      first — so an admin token for "club-x" replayed beside a member cookie
 *      for BPM passed the admin check and then acted on BPM.
 *   2. `PATCH` / `DELETE /api/members` took any member id with no roster check,
 *      so that same admin could hard-delete a BPM member outright.
 * The attacker here is the test admin: owner of club-x, a plain member of BPM.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  seedMembership('bpm', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'member' });
  lin = seedMember('Lin');
  seedMembership('bpm', lin.id, { name: 'Lin', role: 'member' });
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

const cookies = (adminGroup: string, memberGroup?: string) => ({
  Cookie: [
    `admin_session=${adminCookieValue({ groupId: adminGroup })}`,
    ...(memberGroup ? [`member_session=${memberCookieValue(getTestAdminName(), ADMIN_MEMBER_ID, undefined, memberGroup)}`] : []),
  ].join('; '),
});
const linDoc = () => (getStore()['members'] as { id: string; active?: boolean }[]).find((m) => m.id === lin.id);

describe('the two cookies must name the same club', () => {
  it('refuses an admin token for one club beside a member token for another', async () => {
    const req = makeRequest('POST', 'http://x/api/x', undefined, cookies('club-x', 'bpm'));
    expect(isAdminAuthed(req)).toBe(false);
    expect(await isAdminAuthedWithMember(req)).toEqual({ authed: false });
  });

  it('still admits a pair that agrees (the vacuity guard)', async () => {
    const req = makeRequest('POST', 'http://x/api/x', undefined, cookies('club-x', 'club-x'));
    expect(isAdminAuthed(req)).toBe(true);
    expect(await isAdminAuthedWithMember(req)).toMatchObject({ authed: true, groupId: 'club-x' });
  });

  it('cannot issue a BPM recovery code from a club-x admin token', async () => {
    const res = await resetAccess(makeRequest('POST', 'http://x/api/players/reset-access', { name: 'Lin' }, cookies('club-x', 'bpm')));
    expect(res.status).toBe(401);
  });

  it('flag off: the claims are ignored, as everywhere else', async () => {
    delete process.env[FLAG];
    const req = makeRequest('POST', 'http://x/api/x', undefined, cookies('club-x', 'bpm'));
    expect(isAdminAuthed(req)).toBe(true);
  });
});

describe('/api/members PATCH and DELETE stay inside the admin\'s roster', () => {
  it('refuses a hard delete outright, and leaves the person alone', async () => {
    const res = await deleteMember(makeRequest('DELETE', 'http://x/api/members', { id: lin.id, hard: true }, cookies('club-x')));
    expect(res.status).toBe(403);
    expect(linDoc()).toBeTruthy();
  });

  it('answers 404 for someone off the roster, on soft delete and on PATCH', async () => {
    const del = await deleteMember(makeRequest('DELETE', 'http://x/api/members', { id: lin.id }, cookies('club-x')));
    expect(del.status).toBe(404);
    const patch = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: lin.id, active: false, clearPin: true }, cookies('club-x')));
    expect(patch.status).toBe(404);
    expect(linDoc()?.active).toBe(true);
  });

  it('still edits someone on the admin\'s own roster (the vacuity guard)', async () => {
    seedMembership('club-x', lin.id, { name: 'Lin', role: 'member' });
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: lin.id, canString: true }, cookies('club-x')));
    expect(res.status).toBe(200);
  });
});
