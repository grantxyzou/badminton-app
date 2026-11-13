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
import { GET as READ_LINK, POST as NEW_LINK } from '@/app/api/groups/claim-link/route';
import { GET as PREVIEW } from '@/app/api/groups/preview/route';
import { PATCH as PATCH_MEMBER } from '@/app/api/members/route';
import { POST as RESET_ACCESS } from '@/app/api/players/reset-access/route';
import { requireGroupMember, sessionRevoked } from '@/lib/auth';
import { rotateClaimLink, resolveClaimLink } from '@/lib/claimLinks';

/**
 * The club's claim link (docs/plans/claim-your-name.md). The test admin is the
 * organiser of club-x, which imported a "Lin" with no credential. BPM has its
 * own Lin and its own admin, so only the club can separate them. Asking
 * THROUGH the link is an account's since step 4d of docs/plans/one-way-in.md
 * (`group-door-link`, `group-door-account`).
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

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
