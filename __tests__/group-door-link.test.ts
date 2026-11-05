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
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as ASK } from '@/app/api/members/access-request/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { GET as PREVIEW } from '@/app/api/groups/preview/route';
import { requireGroupMember } from '@/lib/auth';
import { rotateClaimLink } from '@/lib/claimLinks';
import { MAX_OPEN_JOIN_REQUESTS } from '@/lib/joinRequests';
import { mintInvite } from '@/lib/invites';

/**
 * The club's door link (docs/plans/door-link.md): the claim link widened so a
 * NEW name can ask to join. The test admin is the organiser of club-x (Six
 * Feathers) and only an ADMIN of club-y, so one cookie shows both ranks.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

type GroupDoc = { id: string; joinRequests?: Array<{ id: string; name: string; approvedAt?: number; memberId?: string }> };
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

const ask = async (name: string, claimToken: string = xToken) =>
  (await (await ASK(makeRequest('POST', 'http://x/api/members/access-request', { name, claimToken }))).json()) as { ok: boolean; secret: string };
const poll = (name: string, secret: string, claimToken: string = xToken) =>
  CLAIM(makeRequest('POST', 'http://x/api/members/access-request/claim', { name, secret, claimToken }));
const list = async (groupId: string) =>
  (await (await LIST(makeRequest('GET', 'http://x/api/admin/access-requests', undefined, asAdminOf(groupId)))).json()) as {
    joins: Array<{ joinRequestId: string; name: string; nameTaken: boolean }>;
    organiser: boolean;
  };
const decide = (groupId: string, joinRequestId: string, decision: 'approve' | 'decline') =>
  DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', { joinRequestId, decision }, asAdminOf(groupId)));

describe('the one link', () => {
  it('previews a door token on the invite path as the door, and an invite as an invite', async () => {
    const door = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?token=${xToken}`));
    expect(await door.json()).toEqual({ name: 'Six Feathers', kind: 'door' });
    const invite = (await mintInvite('club-x', ADMIN_MEMBER_ID))!;
    const inv = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?token=${invite.token}`));
    expect(await inv.json()).toEqual({ name: 'Six Feathers', kind: 'invite' });
    const miss = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?token=${'f'.repeat(32)}`));
    expect(miss.status).toBe(404);
  });
});

describe('asking to join', () => {
  it('stores a new name on the club and wakes the organisers only', async () => {
    const { ok, secret } = await ask('Akane');
    expect(ok).toBe(true);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const open = groupDoc('club-x')!.joinRequests!;
    expect(open.map((r) => r.name)).toEqual(['Akane']);
    // Only the hash is stored, never the secret.
    expect(JSON.stringify(open)).not.toContain(secret);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0].ids).toEqual([ADMIN_MEMBER_ID]);
    expect(pushCalls[0].body).toBe('Akane is asking to join Six Feathers.');
    expect(pushCalls[0].tag).toBe(`join-${open[0].id}`);
    // Still waiting: the asking phone hears `pending`, a stranger's secret `none`.
    expect(await (await poll('Akane', secret)).json()).toEqual({ status: 'pending' });
    expect(await (await poll('Akane', 'f'.repeat(64))).json()).toEqual({ status: 'none' });
  });

  it('caps the open asks per club, with the same answer past the cap', async () => {
    for (let i = 0; i < MAX_OPEN_JOIN_REQUESTS; i += 1) await ask(`Player ${i}`);
    const extra = await ask('One too many');
    expect(extra.ok).toBe(true);
    expect(groupDoc('club-x')!.joinRequests).toHaveLength(MAX_OPEN_JOIN_REQUESTS);
  });

  it('a new door link cancels the joins waiting on the old one', async () => {
    await ask('Akane');
    await rotateClaimLink('club-x', ADMIN_MEMBER_ID);
    expect(groupDoc('club-x')!.joinRequests).toBeUndefined();
  });
});

describe('letting them in', () => {
  it('an organiser approves; the asking phone is signed in to that club as a new member', async () => {
    const { secret } = await ask('Akane');
    const { joins, organiser } = await list('club-x');
    expect(organiser).toBe(true);
    expect(joins.map((j) => [j.name, j.nameTaken])).toEqual([['Akane', false]]);

    const res = await decide('club-x', joins[0].joinRequestId, 'approve');
    expect(res.status).toBe(200);
    expect(membershipOf('club-x', 'Akane')?.status).toBe('active');

    const got = await poll('Akane', secret);
    const body = await got.json();
    expect(body).toMatchObject({ status: 'approved', name: 'Akane', hasPin: false, joined: true });
    const cookie = /member_session=([^;]+)/.exec(got.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const session = await requireGroupMember(makeRequest('GET', 'http://x/', undefined, { Cookie: `member_session=${cookie}` }));
    expect(session?.groupId).toBe('club-x');
    expect(session?.name).toBe('Akane');

    // Single use: the request is gone, and a replay signs nobody in.
    expect(groupDoc('club-x')!.joinRequests).toEqual([]);
    const replay = await poll('Akane', secret);
    expect((await replay.json()).status).toBe('none');
    expect(replay.headers.get('set-cookie')).toBeNull();
  });

  it('an admin who is not an organiser sees the ask and cannot approve or decline it', async () => {
    const { secret } = await ask('Kento', yToken);
    const { joins, organiser } = await list('club-y');
    expect(organiser).toBe(false);
    expect(joins.map((j) => j.name)).toEqual(['Kento']);
    expect((await decide('club-y', joins[0].joinRequestId, 'approve')).status).toBe(403);
    expect((await decide('club-y', joins[0].joinRequestId, 'decline')).status).toBe(403);
    expect(membershipOf('club-y', 'Kento')).toBeUndefined();
    expect((await (await poll('Kento', secret, yToken)).json()).status).toBe('pending');
    // Woken: Club Y's organiser, not the admin.
    expect(pushCalls.at(-1)!.ids).toEqual([yOwner.id]);
  });

  it('one club’s organiser cannot approve another club’s ask', async () => {
    await ask('Kento', yToken);
    const yJoin = groupDoc('club-y')!.joinRequests![0];
    const res = await decide('club-x', yJoin.id, 'approve');
    expect(res.status).toBe(404);
    expect(membershipOf('club-y', 'Kento')).toBeUndefined();
  });

  it('a name a member already holds is shown as taken and refused at approval; their account is untouched', async () => {
    const viktor = seedMember('Viktor', { pinHash: 'theirs' });
    seedMembership('club-x', viktor.id, { name: 'Viktor' });
    const { secret } = await ask('Viktor');
    const { joins } = await list('club-x');
    expect(joins.map((j) => [j.name, j.nameTaken])).toEqual([['Viktor', true]]);
    expect(pushCalls[0].body).toContain('That name is taken.');
    // Never an access request on Viktor's own account.
    expect((getStore()['members'] as Array<{ id: string; accessRequests?: unknown[] }>).find((m) => m.id === viktor.id)!.accessRequests).toBeUndefined();
    const res = await decide('club-x', joins[0].joinRequestId, 'approve');
    expect(res.status).toBe(409);
    expect((getStore()['members'] as Array<{ name: string }>).filter((m) => m.name === 'Viktor')).toHaveLength(1);
    expect((await (await poll('Viktor', secret)).json()).status).toBe('pending');
  });

  it('a removed member’s name is free again, and approval makes a new person, never the old account', async () => {
    const gone = seedMember('Kento', { pinHash: 'old' });
    seedMembership('club-x', gone.id, { name: 'Kento', status: 'removed' });
    await ask('Kento');
    const { joins } = await list('club-x');
    expect(joins[0].nameTaken).toBe(false);
    expect((await decide('club-x', joins[0].joinRequestId, 'approve')).status).toBe(200);
    const rows = ((getStore()['memberships'] ?? []) as Array<{ groupId: string; kind?: string; name?: string; status?: string; memberId?: string }>)
      .filter((m) => m.groupId === 'club-x' && m.kind === undefined && m.name === 'Kento');
    const active = rows.filter((m) => m.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0].memberId).not.toBe(gone.id);
    // The old account stays removed.
    expect(rows.find((m) => m.memberId === gone.id)?.status).toBe('removed');
  });

  it('declining sends the asking phone `none`', async () => {
    const { secret } = await ask('Carolina');
    const { joins } = await list('club-x');
    expect((await decide('club-x', joins[0].joinRequestId, 'decline')).status).toBe(200);
    expect((await (await poll('Carolina', secret)).json()).status).toBe('none');
  });

  it('approving twice makes one account', async () => {
    await ask('Akane');
    const id = groupDoc('club-x')!.joinRequests![0].id;
    const [a, b] = await Promise.all([decide('club-x', id, 'approve'), decide('club-x', id, 'approve')]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const akanes = (getStore()['members'] as Array<{ name: string }>).filter((m) => m.name === 'Akane');
    expect(akanes).toHaveLength(1);
  });
});

describe('an imported name through the door', () => {
  it('is an organiser’s to let in, not an admin’s', async () => {
    const lin = seedMember('Lin');
    seedMembership('club-y', lin.id, { name: 'Lin' });
    await ask('Lin', yToken);
    const raw = (await (await LIST(makeRequest('GET', 'http://x/api/admin/access-requests', undefined, asAdminOf('club-y')))).json()) as {
      requests: Array<{ memberId: string; requestId: string }>;
    };
    expect(raw.requests).toHaveLength(1);
    const res = await DECIDE(
      makeRequest(
        'POST',
        'http://x/api/admin/access-requests',
        { memberId: raw.requests[0].memberId, requestId: raw.requests[0].requestId, decision: 'approve' },
        asAdminOf('club-y'),
      ),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'organiser_only' });
    // The push for an imported name through the link also went to organisers only.
    expect(pushCalls.at(-1)!.ids).toEqual([yOwner.id]);
  });
});
