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
import { PATCH as patchMember, DELETE as deleteMember } from '@/app/api/members/route';
import { PATCH as patchRosterRole, DELETE as deleteRosterRow } from '@/app/api/groups/members/[memberId]/route';
import { POST as stepDownRoute } from '@/app/api/groups/step-down/route';
import { GET as currentRoute } from '@/app/api/groups/current/route';
import { POST as createGroupRoute } from '@/app/api/groups/route';
import { readGroup, readMembership, reassignOwnership, stepDown } from '@/lib/groups';
import { purgeMember } from '@/lib/memberPurge';

/**
 * Roles v2, PR 1 (docs/plans/roles-v2.md): a club may have SEVERAL organisers,
 * only an organiser hands out a rank or the gift-card switch, and NOBODY
 * removes an organiser — they step down themselves, and when the last one
 * goes the club passes to the longest-serving admin, else player.
 *
 * The test admin is the FOUNDER of club-x (`ownerMemberId`), with a second
 * organiser Sam, an admin Ada and a player Lin beside them. Every rule here is
 * exercised through BOTH role routes, because the one-owner invariant they
 * replace was enforced in both.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
const CLUB = 'club-x';

let sam: { id: string };
let ada: { id: string };
let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup(CLUB, { ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership(CLUB, ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner', joinedAt: '2026-01-01T00:00:00Z' });
  sam = seedMember('Sam');
  seedMembership(CLUB, sam.id, { name: 'Sam', role: 'owner', joinedAt: '2026-02-01T00:00:00Z' });
  ada = seedMember('Ada');
  seedMembership(CLUB, ada.id, { name: 'Ada', role: 'admin', joinedAt: '2026-03-01T00:00:00Z' });
  lin = seedMember('Lin');
  seedMembership(CLUB, lin.id, { name: 'Lin', role: 'member', joinedAt: '2026-04-01T00:00:00Z' });
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

/** The test admin's cookie, as the rank the membership row currently holds. */
const asAdminOf = (groupId = CLUB) => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });
const rowOf = (memberId: string) =>
  (getStore()['memberships'] as Array<{ id: string; role: string; status: string; canGift?: boolean }>).find((m) => m.id === `${CLUB}:${memberId}`)!;
const demoteCallerTo = (role: 'admin') => { rowOf(ADMIN_MEMBER_ID).role = role; };
const params = (memberId: string) => ({ params: Promise.resolve({ memberId }) });

describe('a rank is an organiser\'s to hand out', () => {
  it('an admin cannot promote through PATCH /api/members, and the rank stays', async () => {
    demoteCallerTo('admin');
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: lin.id, role: 'admin' }, asAdminOf()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('organiser_only');
    expect(rowOf(lin.id).role).toBe('member');
  });

  it('an admin cannot promote through PATCH /api/groups/members/[id] either', async () => {
    demoteCallerTo('admin');
    const res = await patchRosterRole(makeRequest('PATCH', `http://x/api/groups/members/${lin.id}`, { role: 'admin' }, asAdminOf()), params(lin.id));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('organiser_only');
  });

  it('an admin saving a name edit with the rank UNCHANGED is not refused', async () => {
    demoteCallerTo('admin');
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: lin.id, role: 'member', name: 'Lin W' }, asAdminOf()));
    expect(res.status).toBe(200);
    expect((await readMembership(CLUB, lin.id))?.name).toBe('Lin W');
  });

  it('an organiser promotes to admin AND to organiser, so a club can hold several', async () => {
    const up = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: ada.id, role: 'owner' }, asAdminOf()));
    expect(up.status).toBe(200);
    expect(rowOf(ada.id).role).toBe('owner');
    const viaRoster = await patchRosterRole(makeRequest('PATCH', `http://x/api/groups/members/${lin.id}`, { role: 'owner' }, asAdminOf()), params(lin.id));
    expect(viaRoster.status).toBe(200);
    expect((await viaRoster.json()).role).toBe('owner');
    const organisers = (getStore()['memberships'] as Array<{ groupId: string; role: string; kind?: string }>)
      .filter((m) => m.groupId === CLUB && !m.kind && m.role === 'owner');
    expect(organisers).toHaveLength(4);
  });

  it('`owner` is not a rank the flag-off route knows', async () => {
    process.env[FLAG] = 'false';
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: lin.id, role: 'owner' }, asAdminOf('bpm')));
    expect(res.status).toBe(400);
  });
});

describe('nobody removes an organiser', () => {
  it('another organiser cannot demote, deactivate or remove one, on either route', async () => {
    const demote = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: sam.id, role: 'member' }, asAdminOf()));
    expect(demote.status).toBe(403);
    expect((await demote.json()).error).toBe('owner_immutable');
    const deactivate = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: sam.id, active: false }, asAdminOf()));
    expect(deactivate.status).toBe(403);
    const remove = await deleteMember(makeRequest('DELETE', 'http://x/api/members', { id: sam.id }, asAdminOf()));
    expect(remove.status).toBe(403);
    const rosterDemote = await patchRosterRole(makeRequest('PATCH', `http://x/api/groups/members/${sam.id}`, { role: 'admin' }, asAdminOf()), params(sam.id));
    expect(rosterDemote.status).toBe(403);
    expect((await rosterDemote.json()).error).toBe('owner_immutable');
    const rosterRemove = await deleteRosterRow(makeRequest('DELETE', `http://x/api/groups/members/${sam.id}`), params(sam.id));
    expect(rosterRemove.status).toBe(401); // no cookie at all — and with one:
    const rosterRemoveAuthed = await deleteRosterRow(makeRequest('DELETE', `http://x/api/groups/members/${sam.id}`, undefined, asAdminOf()), params(sam.id));
    expect(rosterRemoveAuthed.status).toBe(403);
    expect(rowOf(sam.id)).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('a second organiser, not the founder, reads as owner of the club', async () => {
    const res = await currentRoute(
      makeRequest('GET', 'http://x/api/groups/current', undefined, { Cookie: `member_session=${memberCookieValue('Sam', sam.id, undefined, CLUB)}` }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'owner', isOwner: true });
  });
});

describe('stepping down', () => {
  const post = (body: Record<string, unknown>, headers = asAdminOf()) =>
    stepDownRoute(makeRequest('POST', 'http://x/api/groups/step-down', body, headers));

  it('is refused for an admin — only an organiser has a rank to give up', async () => {
    demoteCallerTo('admin');
    const res = await post({ to: 'member' });
    expect(res.status).toBe(403);
  });

  it('with another organiser present, hands nothing on; the founder\'s pointer moves to the longest-serving one', async () => {
    const res = await post({ to: 'admin' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'admin', handedTo: null });
    expect(rowOf(ADMIN_MEMBER_ID).role).toBe('admin');
    expect(rowOf(sam.id).role).toBe('owner');
    expect((await readGroup(CLUB))?.ownerMemberId).toBe(sam.id);
    expect((await readGroup(CLUB))?.closedAt).toBeUndefined();
  });

  it('the LAST organiser passes the club to the longest-serving admin, and a player loses the admin cookie', async () => {
    rowOf(sam.id).status = 'removed';
    const res = await post({ to: 'member' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: 'member', handedTo: ada.id });
    expect(rowOf(ada.id).role).toBe('owner');
    expect(rowOf(ADMIN_MEMBER_ID).role).toBe('member');
    expect((await readGroup(CLUB))?.ownerMemberId).toBe(ada.id);
    expect(res.headers.get('set-cookie')).toMatch(/admin_session=;/);
  });

  it('staying on as admin keeps the admin cookie', async () => {
    const res = await post({ to: 'admin' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('the only person in a club is refused: stepping down must not close it', async () => {
    for (const id of [sam.id, ada.id, lin.id]) rowOf(id).status = 'removed';
    const res = await post({ to: 'member' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('last_member');
    expect(rowOf(ADMIN_MEMBER_ID).role).toBe('owner');
    expect((await readGroup(CLUB))?.closedAt).toBeUndefined();
  });

  it('validates the rank asked for, after auth', async () => {
    expect((await post({ to: 'owner' })).status).toBe(400);
    expect((await post({ to: 'member' }, { Cookie: '' })).status).toBe(401);
  });

  it('is absent with the flag off', async () => {
    process.env[FLAG] = 'false';
    expect((await post({ to: 'member' })).status).toBe(404);
  });

  it('lib: the last organiser with only players hands the club to the earliest one', async () => {
    rowOf(sam.id).status = 'removed';
    rowOf(ada.id).status = 'removed';
    expect(await stepDown(CLUB, ADMIN_MEMBER_ID, 'member')).toEqual({ outcome: 'stepped_down', role: 'member', handedTo: lin.id });
    expect(rowOf(lin.id).role).toBe('owner');
  });
});

describe('an organiser leaving the app', () => {
  it('`reassignOwnership` answers others_remain and the club stays open', async () => {
    expect(await reassignOwnership(CLUB, sam.id)).toEqual({ outcome: 'others_remain' });
    // Sam was not the founder, so the pointer did not move.
    expect((await readGroup(CLUB))?.ownerMemberId).toBe(ADMIN_MEMBER_ID);
    expect((await readGroup(CLUB))?.closedAt).toBeUndefined();
  });

  it('purging the founder with a co-organiser keeps the club, under the co-organiser\'s name', async () => {
    const summary = await purgeMember(ADMIN_MEMBER_ID, getTestAdminName());
    expect(summary.groupsClosed).toBe(0);
    expect(summary.groupsReassigned).toBe(0);
    const group = await readGroup(CLUB);
    expect(group?.closedAt).toBeUndefined();
    expect(group?.ownerMemberId).toBe(sam.id);
    expect(rowOf(sam.id).role).toBe('owner');
  });
});

describe('founding a club', () => {
  it('counts the clubs a person is the NAMED owner of, not every club they help organise', async () => {
    // Sam co-organises ten clubs founded by others — and may still found one.
    for (let i = 0; i < 10; i++) {
      seedGroup(`co-${i}`, { ownerMemberId: 'someone-else' });
      seedMembership(`co-${i}`, sam.id, { name: 'Sam', role: 'owner' });
    }
    const res = await createGroupRoute(
      makeRequest('POST', 'http://x/api/groups', { name: 'Sam Saturdays' }, { Cookie: `member_session=${memberCookieValue('Sam', sam.id, undefined, CLUB)}` }),
    );
    expect(res.status).toBe(201);
  });
});
