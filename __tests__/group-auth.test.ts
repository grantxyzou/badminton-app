import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  seedDoc,
  makeRequest,
  memberCookieValue,
  adminCookieValue,
  getTestPin,
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';
import {
  setMemberCookie,
  setAdminCookie,
  verifyMemberAuth,
  peekMemberSession,
  isAdminAuthedWithMember,
  requireGroupMember,
  readGroupClaim,
} from '@/lib/auth';
import { completeSignIn } from '@/lib/authSession';
import { resolveGroupId, resolveGroupIdFromCookieHeader } from '@/lib/groupContext';
import { BPM_GROUP_ID } from '@/lib/groupScope';
import { readMembership } from '@/lib/groups';
import { POST as adminLogin } from '@/app/api/admin/route';

/**
 * PHASE 2, PR 2: the `groupId` CLAIM.
 *
 * Both session cookies carry an optional `groupId`. It is verified at MINT
 * time — `completeSignIn` reads the membership once and stamps an
 * `admin_session` only when the person is owner/admin IN THAT GROUP — so the
 * sync hot-path checks (`isAdminAuthed`, `resolveGroupId`) keep their
 * signature-and-expiry contract. A cookie minted before the claim existed has
 * no `groupId` and reads as BPM's; a claim on a deployment with the flag OFF is
 * ignored outright (a forged claim must not move a request between groups on
 * a deployment that has not turned groups on).
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
const on = () => { process.env[FLAG] = 'true'; };
const off = () => { delete process.env[FLAG]; };

const cookieHeaders = (res: NextResponse) => res.headers.getSetCookie().join('\n');
/** The signed payload of a `name=value` cookie header, decoded. */
function payloadOf(headers: string, name: string): Record<string, unknown> | null {
  const m = headers.match(new RegExp(`${name}=([^;]+);`));
  if (!m) return null;
  const b64 = m[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64 + '==='.slice((b64.length + 3) % 4), 'base64').toString('utf8'));
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  off();
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('the claim on the cookie', () => {
  it('is stamped by both mint functions and defaults to BPM', () => {
    const res = NextResponse.json({});
    setMemberCookie(res, 'm1', 'Lin');
    setAdminCookie(res, 'm1', 'Lin', 'club-x');
    const h = cookieHeaders(res);
    expect(payloadOf(h, 'member_session')?.groupId).toBe(BPM_GROUP_ID);
    expect(payloadOf(h, 'admin_session')?.groupId).toBe('club-x');
  });

  it('comes back from verifyMemberAuth and peekMemberSession, BPM when the cookie predates it', () => {
    const modern = makeRequest('GET', 'http://x/api/x', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'm1', 3600, 'club-x')}` });
    expect(verifyMemberAuth(modern)).toEqual({ memberId: 'm1', name: 'Lin', groupId: 'club-x' });
    const legacy = makeRequest('GET', 'http://x/api/x', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'm1', 3600, null)}` });
    expect(verifyMemberAuth(legacy)).toEqual({ memberId: 'm1', name: 'Lin', groupId: BPM_GROUP_ID });
    const lapsed = makeRequest('GET', 'http://x/api/x', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'm1', -10, 'club-x')}` });
    expect(verifyMemberAuth(lapsed)).toBeNull();
    expect(peekMemberSession(lapsed)?.groupId).toBe('club-x');
  });

  it('readGroupClaim refuses a tampered token', () => {
    const good = memberCookieValue('Lin', 'm1', 3600, 'club-x');
    expect(readGroupClaim(good)).toBe('club-x');
    expect(readGroupClaim(good.slice(0, -2) + 'zz')).toBeNull();
    expect(readGroupClaim('not-a-token')).toBeNull();
    expect(readGroupClaim(undefined)).toBeNull();
  });
});

describe('resolveGroupId', () => {
  const withMember = (groupId: string | null) =>
    makeRequest('GET', 'http://x/api/session', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'm1', 3600, groupId)}` });

  it('ignores the claim while the flag is OFF', () => {
    expect(resolveGroupId(withMember('club-x'))).toBe(BPM_GROUP_ID);
    expect(resolveGroupIdFromCookieHeader(`member_session=${memberCookieValue('Lin', 'm1', 3600, 'club-x')}`)).toBe(BPM_GROUP_ID);
  });

  it('honours a signed claim when the flag is ON, and falls back to BPM without one', () => {
    on();
    expect(resolveGroupId(withMember('club-x'))).toBe('club-x');
    expect(resolveGroupId(withMember(null))).toBe(BPM_GROUP_ID);
    expect(resolveGroupId(makeRequest('GET', 'http://x/api/session'))).toBe(BPM_GROUP_ID);
  });

  it('never trusts an unsigned or expired claim', () => {
    on();
    const forged = Buffer.from(JSON.stringify({ memberId: 'm1', name: 'Lin', groupId: 'club-x', iat: 1, exp: 9e9 })).toString('base64url');
    expect(resolveGroupId(makeRequest('GET', 'http://x/api/session', undefined, { Cookie: `member_session=${forged}.nope` }))).toBe(BPM_GROUP_ID);
    expect(resolveGroupId(makeRequest('GET', 'http://x/api/session', undefined, { Cookie: `member_session=${memberCookieValue('Lin', 'm1', -10, 'club-x')}` }))).toBe(BPM_GROUP_ID);
  });

  it('reads the admin cookie when that is the only session on the device', () => {
    on();
    const req = makeRequest('GET', 'http://x/api/session', undefined, { Cookie: `admin_session=${adminCookieValue({ groupId: 'club-x' })}` });
    expect(resolveGroupId(req)).toBe('club-x');
  });

  it('has a server-component twin that parses the raw cookie header', () => {
    on();
    const header = `NEXT_LOCALE=en; member_session=${memberCookieValue('Lin', 'm1', 3600, 'club-x')}; other=1`;
    expect(resolveGroupIdFromCookieHeader(header)).toBe('club-x');
    expect(resolveGroupIdFromCookieHeader(null)).toBe(BPM_GROUP_ID);
    expect(resolveGroupIdFromCookieHeader('member_session=garbage')).toBe(BPM_GROUP_ID);
  });
});

describe('completeSignIn(res, member, groupId)', () => {
  it('flag OFF: the Member doc’s role decides admin, exactly as before', async () => {
    const res = NextResponse.json({});
    await completeSignIn(res, { id: 'm1', name: 'Grant', role: 'admin' }, BPM_GROUP_ID);
    const h = cookieHeaders(res);
    expect(payloadOf(h, 'admin_session')?.groupId).toBe(BPM_GROUP_ID);
    expect(payloadOf(h, 'member_session')?.groupId).toBe(BPM_GROUP_ID);
  });

  it('flag ON: admin only when the membership IN THAT GROUP says owner or admin', async () => {
    on();
    seedMembership('club-x', 'm1', { name: 'Grant', role: 'admin' });
    seedMembership('club-y', 'm1', { name: 'Grant', role: 'member' });
    const inX = NextResponse.json({});
    await completeSignIn(inX, { id: 'm1', name: 'Grant', role: 'admin' }, 'club-x');
    expect(payloadOf(cookieHeaders(inX), 'admin_session')?.groupId).toBe('club-x');

    const inY = NextResponse.json({});
    await completeSignIn(inY, { id: 'm1', name: 'Grant', role: 'admin' }, 'club-y');
    expect(cookieHeaders(inY)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
    expect(payloadOf(cookieHeaders(inY), 'member_session')?.groupId).toBe('club-y');
  });

  it('flag ON: a Member-doc admin with NO membership in the group is not an admin there', async () => {
    on();
    const res = NextResponse.json({});
    await completeSignIn(res, { id: 'm1', name: 'Grant', role: 'admin' }, 'club-x');
    expect(cookieHeaders(res)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });

  it('flag ON: a removed membership grants nothing', async () => {
    on();
    seedMembership('club-x', 'm1', { name: 'Grant', role: 'owner', status: 'removed' });
    const res = NextResponse.json({});
    await completeSignIn(res, { id: 'm1', name: 'Grant', role: 'admin' }, 'club-x');
    expect(cookieHeaders(res)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });
});

describe('isAdminAuthedWithMember', () => {
  const adminReq = (groupId?: string) =>
    makeRequest('POST', 'http://x/api/x', undefined, { Cookie: `admin_session=${adminCookieValue(groupId ? { groupId } : {})}` });

  it('flag OFF: the Member doc decides, and the result names BPM', async () => {
    expect(await isAdminAuthedWithMember(adminReq())).toEqual({ authed: true, memberId: ADMIN_MEMBER_ID, name: getTestAdminName(), groupId: BPM_GROUP_ID });
    // A claim on the cookie is ignored, like everywhere else with the flag off.
    expect(await isAdminAuthedWithMember(adminReq('club-x'))).toMatchObject({ authed: true, groupId: BPM_GROUP_ID });
  });

  it('flag ON: needs an active owner/admin membership in the claimed group', async () => {
    on();
    expect(await isAdminAuthedWithMember(adminReq('club-x'))).toEqual({ authed: false });
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'member' });
    expect(await isAdminAuthedWithMember(adminReq('club-x'))).toEqual({ authed: false });
    seedMembership('club-z', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'admin' });
    expect(await isAdminAuthedWithMember(adminReq('club-z'))).toMatchObject({ authed: true, groupId: 'club-z' });
  });

  it('flag ON: an inactive Member is refused even with a good membership', async () => {
    on();
    seedMembership('club-z', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
    const store = (await import('./helpers')).getStore();
    const me = (store['members'] as { id: string; active: boolean }[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
    me.active = false;
    expect(await isAdminAuthedWithMember(adminReq('club-z'))).toEqual({ authed: false });
  });
});

describe('requireGroupMember', () => {
  const memberReq = (groupId: string | null, memberId = 'm1') =>
    makeRequest('POST', 'http://x/api/x', undefined, { Cookie: `member_session=${memberCookieValue('Lin', memberId, 3600, groupId)}` });

  it('is null with no session', async () => {
    expect(await requireGroupMember(makeRequest('POST', 'http://x/api/x'))).toBeNull();
  });

  it('flag OFF: any active signed-in person is in BPM, with Member.role as the role', async () => {
    const lin = seedMember('Lin');
    expect(await requireGroupMember(memberReq(null, lin.id))).toEqual({ memberId: lin.id, name: 'Lin', groupId: BPM_GROUP_ID, role: 'member' });
    // A BPM admin is an admin here too — otherwise a Phase 3 route gating on
    // this would refuse every admin while the flag is off.
    const adminReq = makeRequest('POST', 'http://x/api/x', undefined, { Cookie: `member_session=${memberCookieValue(getTestAdminName(), ADMIN_MEMBER_ID, 3600, null)}` });
    expect((await requireGroupMember(adminReq))?.role).toBe('admin');
    // Unknown or inactive person: nobody.
    expect(await requireGroupMember(memberReq(null, 'ghost'))).toBeNull();
  });

  it('flag ON: needs an ACTIVE membership in the claimed group, and reports its role', async () => {
    on();
    expect(await requireGroupMember(memberReq('club-x'))).toBeNull();
    seedMembership('club-x', 'm1', { name: 'Lin', role: 'admin', status: 'left' });
    expect(await requireGroupMember(memberReq('club-x'))).toBeNull();
    seedMembership('club-y', 'm1', { name: 'Lin Dan', role: 'owner' });
    expect(await requireGroupMember(memberReq('club-y'))).toEqual({ memberId: 'm1', name: 'Lin Dan', groupId: 'club-y', role: 'owner' });
  });
});

describe('POST /api/admin (the admin login mint site)', () => {
  const login = (cookie?: string) =>
    adminLogin(makeRequest('POST', 'http://x/api/admin', { name: getTestAdminName(), pin: getTestPin() }, cookie ? { Cookie: cookie } : undefined));

  it('flag OFF: unchanged — Member.role admin + PIN, cookie claims BPM', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(payloadOf(cookieHeaders(res), 'admin_session')?.groupId).toBe(BPM_GROUP_ID);
  });

  it('flag ON: refuses an admin of the Member doc who holds no admin membership in the resolved group', async () => {
    on();
    seedGroup('club-x');
    const inX = `member_session=${memberCookieValue(getTestAdminName(), ADMIN_MEMBER_ID, 3600, 'club-x')}`;
    expect((await login(inX)).status).toBe(401);
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
    const res = await login(inX);
    expect(res.status).toBe(200);
    expect(payloadOf(cookieHeaders(res), 'admin_session')?.groupId).toBe('club-x');
  });

  it('flag ON: the ADMIN_NAMES bootstrap promotes only in BPM', async () => {
    on();
    const prev = process.env.ADMIN_NAMES;
    process.env.ADMIN_NAMES = 'Newbie';
    try {
      const { hashPin } = await import('@/lib/recoveryHash');
      const m = seedMember('Newbie', { pinHash: await hashPin(getTestPin()) });
      // In BPM the env var still turns a member into an admin — Member.role AND the BPM membership, which is what admits them with groups on.
      const bpm = await adminLogin(makeRequest('POST', 'http://x/api/admin', { name: 'Newbie', pin: getTestPin() }));
      expect(bpm.status).toBe(200);
      expect((await readMembership(BPM_GROUP_ID, m.id))?.role).toBe('admin');
      // A name somebody ELSE holds in BPM cannot be promoted — and that is a 401, never a 500.
      const rival = seedMember('Rival', { pinHash: await hashPin(getTestPin()) });
      process.env.ADMIN_NAMES = 'Rival';
      seedDoc('memberships', { id: 'bpm:name:rival', groupId: 'bpm', kind: 'name', memberId: 'someone-else', name: 'Rival' });
      const blocked = await adminLogin(makeRequest('POST', 'http://x/api/admin', { name: 'Rival', pin: getTestPin() }));
      expect(blocked.status).toBe(401);
      expect(await readMembership(BPM_GROUP_ID, rival.id)).toBeUndefined();
      process.env.ADMIN_NAMES = 'Newbie';
      // In another group the same name is nobody.
      seedMembership('club-x', m.id, { name: 'Newbie', role: 'member' });
      const inX = makeRequest('POST', 'http://x/api/admin', { name: 'Newbie', pin: getTestPin() }, { Cookie: `member_session=${memberCookieValue('Newbie', m.id, 3600, 'club-x')}` });
      expect((await adminLogin(inX)).status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_NAMES; else process.env.ADMIN_NAMES = prev;
    }
  });
});
