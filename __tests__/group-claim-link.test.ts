import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const pushCalls: Array<{ ids: string[] }> = [];
vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return {
    ...real,
    sendPushToMembers: vi.fn(async (ids: string[]) => {
      pushCalls.push({ ids });
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
  memberCookieValue,
  getTestAdminName,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as ASK } from '@/app/api/members/access-request/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { GET as READ_LINK, POST as NEW_LINK } from '@/app/api/groups/claim-link/route';
import { GET as PREVIEW } from '@/app/api/groups/preview/route';
import { PATCH as PATCH_MEMBER } from '@/app/api/members/route';
import { POST as RESET_ACCESS } from '@/app/api/players/reset-access/route';
import { requireGroupMember, sessionRevoked } from '@/lib/auth';
import { rotateClaimLink, resolveClaimLink } from '@/lib/claimLinks';

/**
 * Claim your name (docs/plans/claim-your-name.md). The test admin is the
 * organiser of club-x, which imported a "Lin" with no credential. BPM has its
 * own Lin and its own admin, so only the club can separate them.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

type Stored = { id: string; accessRequests?: Array<{ groupId?: string; via?: string; approvedAt?: number }>; pinHash?: string };
const memberDoc = (id: string) => (getStore()['members'] as Stored[]).find((m) => m.id === id);
const membership = (groupId: string, memberId: string) =>
  ((getStore()['memberships'] ?? []) as Array<{ id: string; sessionsNotBefore?: string; widgetPassNotBefore?: string }>).find(
    (m) => m.id === `${groupId}:${memberId}`,
  );

const asAdminOf = (groupId: string) => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });

let xLin: { id: string };
let bpmLin: { id: string };
let bpmAdmin: { id: string };
let token: string;

beforeEach(async () => {
  resetMockStore();
  pushCalls.length = 0;
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Six Feathers' });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  xLin = seedMember('Lin'); // imported: no PIN, no password, nothing linked
  seedMembership('club-x', xLin.id, { name: 'Lin' });
  bpmLin = seedMember('Lin', { pinHash: 'x' });
  seedMembership('bpm', bpmLin.id, { name: 'Lin' });
  bpmAdmin = seedMember('Grant');
  seedMembership('bpm', bpmAdmin.id, { name: 'Grant', role: 'admin' });
  token = (await rotateClaimLink('club-x', ADMIN_MEMBER_ID))!.token;
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

const ask = (name: string, claimToken: unknown = token) =>
  ASK(makeRequest('POST', 'http://x/api/members/access-request', { name, claimToken }));
const claim = (name: string, secret: string, claimToken: unknown = token) =>
  CLAIM(makeRequest('POST', 'http://x/api/members/access-request/claim', { name, secret, claimToken }));
const list = async (groupId: string) =>
  ((await (await LIST(makeRequest('GET', 'http://x/api/admin/access-requests', undefined, asAdminOf(groupId)))).json()) as {
    requests: Array<{ memberId: string; requestId: string | null; viaLink: boolean; neverSignedIn: boolean }>;
  }).requests;
const approve = (groupId: string, memberId: string, requestId: string) =>
  DECIDE(makeRequest('POST', 'http://x/api/admin/access-requests', { memberId, requestId, decision: 'approve' }, asAdminOf(groupId)));

describe('the link', () => {
  it('resolves to its club until a new one replaces it', async () => {
    expect(await resolveClaimLink(token)).toBe('club-x');
    const next = (await rotateClaimLink('club-x', ADMIN_MEMBER_ID))!.token;
    expect(await resolveClaimLink(next)).toBe('club-x');
    expect(await resolveClaimLink(token)).toBeNull();
  });

  it('previews the club’s name, and one 404 for anything else', async () => {
    const ok = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?claim=${token}`));
    expect(await ok.json()).toEqual({ name: 'Six Feathers', kind: 'door' });
    for (const bad of ['f'.repeat(32), 'not-a-token', '']) {
      const res = await PREVIEW(makeRequest('GET', `http://x/api/groups/preview?claim=${bad}`));
      expect(res.status).toBe(404);
    }
  });

  it('is an organiser’s to read and replace, with how many have not signed in', async () => {
    const anon = await READ_LINK(makeRequest('GET', 'http://x/api/groups/claim-link'));
    expect(anon.status).toBe(401);
    const read = await (await READ_LINK(makeRequest('GET', 'http://x/api/groups/claim-link', undefined, asAdminOf('club-x')))).json();
    expect(read.link.token).toBe(token);
    // Lin; the organiser has a PIN.
    expect(read.unclaimed).toBe(1);
    const made = await NEW_LINK(makeRequest('POST', 'http://x/api/groups/claim-link', {}, asAdminOf('club-x')));
    expect(made.status).toBe(201);
    expect((await made.json()).link.token).not.toBe(token);
  });
});

describe('asking with the link', () => {
  it('asks in the LINK’s club, never BPM’s, and tells only that club’s admins', async () => {
    const res = await ask('Lin');
    expect(res.status).toBe(200);
    expect(memberDoc(xLin.id)?.accessRequests).toEqual([expect.objectContaining({ groupId: 'club-x', via: 'link' })]);
    expect(memberDoc(bpmLin.id)?.accessRequests).toBeUndefined();
    const recipients = pushCalls.flatMap((c) => c.ids);
    expect(recipients).toContain(ADMIN_MEMBER_ID);
    expect(recipients).not.toContain(bpmAdmin.id);
  });

  it('answers an unknown name, a claimed name and a dead link the same, and stores none of them', async () => {
    const claimed = seedMember('Viktor', { pinHash: 'x' });
    seedMembership('club-x', claimed.id, { name: 'Viktor' });
    const answers = await Promise.all([ask('Nobody'), ask('Viktor'), ask('Lin', 'f'.repeat(32)), ask('Lin')]);
    for (const res of answers) {
      expect(res.status).toBe(200);
      expect(typeof (await res.json()).secret).toBe('string');
    }
    expect(memberDoc(claimed.id)?.accessRequests).toBeUndefined();
    expect(memberDoc(xLin.id)?.accessRequests).toHaveLength(1);
  });
});

describe('approving and claiming', () => {
  it('shows the ask to that club’s organiser only, marked, and signs the device in to that club', async () => {
    // The organiser is an admin in BPM too: only the ask's club tells them apart.
    seedMembership('bpm', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
    const { secret } = await (await ask('Lin')).json();
    expect(await list('bpm')).toEqual([]);
    const [row] = await list('club-x');
    expect(row).toMatchObject({ memberId: xLin.id, viaLink: true, neverSignedIn: true });

    expect((await approve('bpm', xLin.id, row.requestId!)).status).toBe(404);
    expect((await approve('club-x', xLin.id, row.requestId!)).status).toBe(200);

    const res = await claim('Lin', secret);
    expect((await res.json()).status).toBe('approved');
    const cookie = res.headers.get('set-cookie') ?? '';
    const value = /member_session=([^;]+)/.exec(cookie)?.[1] ?? '';
    const session = await requireGroupMember(makeRequest('GET', 'http://x/', undefined, { Cookie: `member_session=${value}` }));
    expect(session).toMatchObject({ memberId: xLin.id, groupId: 'club-x' });
  });

  it('a new link cancels the asks made with the old one', async () => {
    const { secret } = await (await ask('Lin')).json();
    const [row] = await list('club-x');
    await approve('club-x', xLin.id, row.requestId!);
    await rotateClaimLink('club-x', ADMIN_MEMBER_ID);
    expect((await (await claim('Lin', secret)).json()).status).toBe('none');
  });
});

describe('sign out everywhere', () => {
  const linSession = () =>
    requireGroupMember(
      makeRequest('GET', 'http://x/', undefined, { Cookie: `member_session=${memberCookieValue('Lin', xLin.id, undefined, 'club-x')}` }),
    );

  it('refuses a session minted before the organiser signed the name out', async () => {
    expect(await linSession()).not.toBeNull();
    const res = await PATCH_MEMBER(
      makeRequest('PATCH', 'http://x/api/members', { id: xLin.id, signOutEverywhere: true }, asAdminOf('club-x')),
    );
    expect(res.status).toBe(200);
    expect(membership('club-x', xLin.id)?.sessionsNotBefore).toBeTruthy();
    expect(membership('club-x', xLin.id)?.widgetPassNotBefore).toBeTruthy();
    expect(await linSession()).toBeNull();
  });

  it('is only for this club’s roster', async () => {
    const res = await PATCH_MEMBER(
      makeRequest('PATCH', 'http://x/api/members', { id: bpmLin.id, signOutEverywhere: true }, asAdminOf('club-x')),
    );
    expect(res.status).toBe(404);
    expect(membership('bpm', bpmLin.id)?.sessionsNotBefore).toBeUndefined();
  });

  it('happens when a recovery code is issued too', async () => {
    const res = await RESET_ACCESS(makeRequest('POST', 'http://x/api/players/reset-access', { name: 'Lin' }, asAdminOf('club-x')));
    expect(res.status).toBe(200);
    expect(await linSession()).toBeNull();
  });

  it('compares in whole seconds, so a sign-in in the same second still works', () => {
    const at = new Date('2026-11-04T10:00:00.900Z').toISOString();
    const second = Math.floor(Date.parse(at) / 1000);
    expect(sessionRevoked(second - 1, at)).toBe(true);
    expect(sessionRevoked(second, at)).toBe(false);
    expect(sessionRevoked(undefined, at)).toBe(false);
    expect(sessionRevoked(second - 1, undefined)).toBe(false);
  });
});
