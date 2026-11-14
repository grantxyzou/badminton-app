import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const pushCalls: Array<{ ids: string[]; body: string; tag?: string }> = [];
vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return {
    ...real,
    sendPushToMembers: vi.fn(async (ids: string[], payload: { body: string; tag?: string }) => {
      pushCalls.push({ ids, body: payload.body, tag: payload.tag });
      return { sent: ids.length, failed: 0, gone: 0 };
    }),
  };
});

import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  makeRequest,
  adminCookieValue,
  getTestAdminName,
  getStore,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as NAME_ASK } from '@/app/api/members/access-request/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { POST as ASK } from '@/app/api/groups/ask/route';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { GET as PREVIEW } from '@/app/api/groups/preview/route';
import { rotateClaimLink } from '@/lib/claimLinks';

/**
 * The club's door link (docs/plans/door-link.md), as it stands after step 4d
 * of docs/plans/one-way-in.md: every ask through it comes from a signed-in
 * ACCOUNT (`POST /api/groups/ask`), and the link no longer takes a name from
 * a signed-out phone. The test admin is the organiser of club-x (Six
 * Feathers) and only an ADMIN of club-y, so one cookie shows both ranks.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

type GroupDoc = { id: string; joinRequests?: Array<{ id: string; name: string; approvedAt?: number; memberId?: string; askedBy?: string; hash?: string; expiresAt?: number; createdAt?: string }> };
const groupDoc = (id: string) => (getStore()['groups'] as GroupDoc[]).find((g) => g.id === id);
const membershipOf = (groupId: string, name: string) =>
  ((getStore()['memberships'] ?? []) as Array<{ groupId: string; kind?: string; name?: string; status?: string; memberId?: string }>).find(
    // Not the name-reservation doc, which carries the name too.
    (m) => m.groupId === groupId && m.kind === undefined && m.name === name,
  );

const asAdminOf = (groupId: string) => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });

let xToken: string;
let yToken: string;
let yOwner: { id: string };

beforeEach(async () => {
  resetMockStore();
  pushCalls.length = 0;
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Six Feathers' });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  yOwner = seedMember('Chong Wei');
  seedGroup('club-y', { ownerMemberId: yOwner.id, name: 'Club Y' });
  seedMembership('club-y', yOwner.id, { name: 'Chong Wei', role: 'owner' });
  seedMembership('club-y', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
  xToken = (await rotateClaimLink('club-x', ADMIN_MEMBER_ID))!.token;
  yToken = (await rotateClaimLink('club-y', yOwner.id))!.token;
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

/** A fresh account (in no club) asks through the link, as `DoorJoinPage` does. */
const ask = async (name: string, token: string = xToken) => {
  const account = seedMember(name);
  const res = await ASK(
    makeRequest('POST', 'http://x/api/groups/ask', { doorToken: token, name }, { Cookie: `member_session=${memberCookieValue(name, account.id)}` }),
  );
  expect(res.status).toBe(200);
  return account;
};
const list = async (groupId: string) =>
  (await (await LIST(makeRequest('GET', 'http://x/api/admin/access-requests', undefined, asAdminOf(groupId)))).json()) as {
    joins: Array<{ joinRequestId: string; name: string; nameTaken: boolean }>;
    requests: Array<{ name: string }>;
    organiser: boolean;
  };
const decide = (groupId: string, joinRequestId: string, decision: 'approve' | 'decline') =>
  DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', { joinRequestId, decision }, asAdminOf(groupId)));

describe('the one link', () => {
  it('previews the club link on the one-link path as the door, and nothing else resolves', async () => {
    const door = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?token=${xToken}`));
    expect(await door.json()).toEqual({ name: 'Six Feathers', kind: 'door' });
    // An old invite's typed code is one more miss (one-way-in step 5).
    expect((await PREVIEW(makeRequest('GET', 'http://x/api/groups/preview?code=ABCD2345'))).status).toBe(404);
    const miss = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?token=${'f'.repeat(32)}`));
    expect(miss.status).toBe(404);
  });
});

describe('the link takes no name from a signed-out phone (one-way-in step 4d)', () => {
  it('stores nothing for any name, wakes nobody, and answers like every other ask', async () => {
    const lin = seedMember('Lin Dan'); // imported, never signed in
    seedMembership('club-x', lin.id, { name: 'Lin Dan' });
    const answers = [];
    for (const name of ['Akane Yamaguchi', 'Lin Dan', 'Sandra']) {
      const res = await NAME_ASK(makeRequest('POST', 'http://x/api/members/access-request', { name, claimToken: xToken }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; secret: string };
      expect(body.ok).toBe(true);
      answers.push(body);
      // Its poll waits out the hour, and nobody is ever signed in from it.
      const polled = await CLAIM(makeRequest('POST', 'http://x/api/members/access-request/claim', { name, secret: body.secret, claimToken: xToken }));
      expect(await polled.json()).toEqual({ status: 'pending' });
      expect(polled.headers.get('set-cookie')).toBeNull();
    }
    expect(groupDoc('club-x')!.joinRequests).toBeUndefined();
    expect((getStore()['members'] as Array<{ id: string; accessRequests?: unknown[] }>).find((m) => m.id === lin.id)!.accessRequests).toBeUndefined();
    expect(pushCalls).toHaveLength(0);
    const { joins, requests } = await list('club-x');
    expect(joins).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('a phone-bound join left from before is not listed and cannot be approved', async () => {
    groupDoc('club-x')!.joinRequests = [
      { id: 'old-join', name: 'Kento Momota', hash: 'a'.repeat(64), createdAt: new Date().toISOString(), expiresAt: Date.now() + 30 * 60 * 1000 },
    ];
    expect((await list('club-x')).joins).toEqual([]);
    expect((await decide('club-x', 'old-join', 'approve')).status).toBe(404);
    expect(membershipOf('club-x', 'Kento Momota')).toBeUndefined();
  });
});

describe('letting an account in', () => {
  it('an admin who is not an organiser sees the ask and cannot approve or decline it', async () => {
    await ask('Kento Momota', yToken);
    const { joins, organiser } = await list('club-y');
    expect(organiser).toBe(false);
    expect(joins.map((j) => j.name)).toEqual(['Kento Momota']);
    expect((await decide('club-y', joins[0].joinRequestId, 'approve')).status).toBe(403);
    expect((await decide('club-y', joins[0].joinRequestId, 'decline')).status).toBe(403);
    expect(membershipOf('club-y', 'Kento Momota')).toBeUndefined();
    // Woken: Club Y's organiser, not the admin.
    expect(pushCalls.at(-1)!.ids).toEqual([yOwner.id]);
  });

  it('one club’s organiser cannot approve another club’s ask', async () => {
    await ask('Kento Momota', yToken);
    const yJoin = groupDoc('club-y')!.joinRequests![0];
    const res = await decide('club-x', yJoin.id, 'approve');
    expect(res.status).toBe(404);
    expect(membershipOf('club-y', 'Kento Momota')).toBeUndefined();
  });

  it('a removed member’s name is free again, and approval adds the asker, never the old account', async () => {
    const gone = seedMember('Kento Momota', { pinHash: 'old' });
    seedMembership('club-x', gone.id, { name: 'Kento Momota', status: 'removed' });
    const asker = await ask('Kento Momota');
    const { joins } = await list('club-x');
    expect(joins[0].nameTaken).toBe(false);
    expect((await decide('club-x', joins[0].joinRequestId, 'approve')).status).toBe(200);
    const rows = ((getStore()['memberships'] ?? []) as Array<{ groupId: string; kind?: string; name?: string; status?: string; memberId?: string }>)
      .filter((m) => m.groupId === 'club-x' && m.kind === undefined && m.name === 'Kento Momota');
    expect(rows.filter((m) => m.status === 'active').map((m) => m.memberId)).toEqual([asker.id]);
    // The old account stays removed.
    expect(rows.find((m) => m.memberId === gone.id)?.status).toBe('removed');
  });

  it('approval tells the whole club on the Notifications page, with no push to the club', async () => {
    const lin = seedMember('Lin Dan');
    seedMembership('club-x', lin.id, { name: 'Lin Dan' });
    const outsider = seedMember('Kento Momota');
    seedMembership('club-y', outsider.id, { name: 'Kento Momota' });
    const sandra = await ask('Sandra Lee');
    expect(pushCalls).toHaveLength(1); // the organiser's "asking to join", nothing more
    const { joins } = await list('club-x');
    expect((await decide('club-x', joins[0].joinRequestId, 'approve')).status).toBe(200);

    // The one push approval adds goes to the person let in, "You're in".
    expect(pushCalls).toHaveLength(2);
    expect(pushCalls[1].ids).toEqual([sandra.id]);
    const notices = ((getStore()['insights'] ?? []) as Array<{ kind?: string; type?: string; memberId: string; memberName?: string; club?: string }>).filter(
      (n) => n.kind === 'notice' && n.type === 'member_joined',
    );
    expect(notices.map((n) => n.memberId).sort()).toEqual([ADMIN_MEMBER_ID, lin.id].sort());
    expect(notices.every((n) => n.memberName === 'Sandra Lee' && n.club === 'Six Feathers')).toBe(true);
    expect(notices.some((n) => n.memberId === outsider.id)).toBe(false);
  });

  it('approving twice adds the account once', async () => {
    const akane = await ask('Akane Yamaguchi');
    const id = groupDoc('club-x')!.joinRequests![0].id;
    const [a, b] = await Promise.all([decide('club-x', id, 'approve'), decide('club-x', id, 'approve')]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const rows = ((getStore()['memberships'] ?? []) as Array<{ groupId: string; kind?: string; memberId?: string }>).filter(
      (m) => m.groupId === 'club-x' && m.kind === undefined && m.memberId === akane.id,
    );
    expect(rows).toHaveLength(1);
  });
});
