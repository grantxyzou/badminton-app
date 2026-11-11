import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  makeRequest,
  adminCookieValue,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { isAdminAuthedWithMember, requireMember, callerMemberId } from '@/lib/auth';
import { PATCH as MEMBERS_PATCH } from '@/app/api/members/route';

/**
 * "Sign out everywhere" ends the ADMIN cookie too (docs/plans/claim-your-name.md,
 * Decisions). The member cookie honoured `sessionsNotBefore` from #771 and
 * #785; `isAdminAuthedWithMember` re-read the role and not the cutoff, so an
 * admin signed out everywhere — or issued a recovery code — kept the console
 * for the cookie's 30 days, and `requireMember` falls back to that cookie, so
 * the page gate let the signed-out phone back into the app as well.
 *
 * Each check runs with the same cookie (minted 60 s ago by `adminCookieValue`)
 * twice: once with the cutoff BEFORE the cookie (control — still an admin),
 * once AFTER it (refused). The control is what makes the refusal mean "the
 * cutoff", not "a bad fixture".
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const saved = process.env[FLAG];

type Row = { id: string; role?: string; sessionsNotBefore?: string };
const rows = (container: string) => (getStore()[container] ?? []) as Row[];
const membershipOf = (memberId: string) => rows('memberships').find((m) => m.id === `bpm:${memberId}`)!;
const memberOf = (memberId: string) => rows('members').find((m) => m.id === memberId)!;

/** The stamp, `secondsFromNow` relative to now: -120 is before the cookie, 0 after it. */
const signOutAt = (doc: Row, secondsFromNow: number) => {
  doc.sessionsNotBefore = new Date(Date.now() + secondsFromNow * 1000).toISOString();
};

const adminReq = (method = 'GET', body?: Record<string, unknown>) =>
  makeRequest(method, 'http://localhost/bpm/api/members', body, { Cookie: `admin_session=${adminCookieValue()}` });

afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function checksRefuse(stampedDoc: () => Row) {
  it('control: a cutoff older than the cookie leaves the admin in', async () => {
    signOutAt(stampedDoc(), -120);
    expect((await isAdminAuthedWithMember(adminReq())).authed).toBe(true);
    expect((await requireMember(adminReq())).ok).toBe(true);
    expect(await callerMemberId(adminReq())).toBe(ADMIN_MEMBER_ID);
  });

  it('a cutoff newer than the cookie refuses isAdminAuthedWithMember, requireMember and callerMemberId', async () => {
    signOutAt(stampedDoc(), 0);
    expect((await isAdminAuthedWithMember(adminReq())).authed).toBe(false);
    const gate = await requireMember(adminReq());
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(401);
    expect(await callerMemberId(adminReq())).toBeNull();
  });
}

describe('groups on: the membership in the claimed club carries the cutoff', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env[FLAG] = 'true';
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID });
    seedAdminMember();
    seedMembership('bpm', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
  });

  checksRefuse(() => membershipOf(ADMIN_MEMBER_ID));

  it('another club’s stamp does not reach this one', async () => {
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
    signOutAt(rows('memberships').find((m) => m.id === `club-x:${ADMIN_MEMBER_ID}`)!, 0);
    expect((await isAdminAuthedWithMember(adminReq())).authed).toBe(true);
  });

  it('end to end: an organiser signing themselves out everywhere loses the console on the next request', async () => {
    const res = await MEMBERS_PATCH(adminReq('PATCH', { id: ADMIN_MEMBER_ID, signOutEverywhere: true }));
    expect(res.status).toBe(200);
    expect(membershipOf(ADMIN_MEMBER_ID).sessionsNotBefore).toBeDefined();
    expect((await isAdminAuthedWithMember(adminReq())).authed).toBe(false);
  });
});

describe('groups off: the Member copy carries the cutoff', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    delete process.env[FLAG];
    seedAdminMember();
  });

  checksRefuse(() => memberOf(ADMIN_MEMBER_ID));
});

describe('who may sign a rank-holder out everywhere (PATCH /api/members)', () => {
  let target: { id: string };
  const signOut = (id: string) => MEMBERS_PATCH(adminReq('PATCH', { id, signOutEverywhere: true }));

  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env[FLAG] = 'true';
    seedGroup('bpm', { ownerMemberId: 'grant' });
    seedAdminMember();
    target = seedMember('Viktor');
  });

  describe('the caller is an ADMIN, not an organiser', () => {
    beforeEach(() => {
      seedMembership('bpm', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'admin' });
    });

    it.each(['owner', 'admin'] as const)('refuses an %s with organiser_only and stamps nothing', async (role) => {
      seedMembership('bpm', target.id, { name: 'Viktor', role });
      const res = await signOut(target.id);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'organiser_only' });
      expect(membershipOf(target.id).sessionsNotBefore).toBeUndefined();
      expect(memberOf(target.id).sessionsNotBefore).toBeUndefined();
    });

    it('signs out a member', async () => {
      seedMembership('bpm', target.id, { name: 'Viktor' });
      expect((await signOut(target.id)).status).toBe(200);
      expect(membershipOf(target.id).sessionsNotBefore).toBeDefined();
    });

    it('signs out themselves (a phone that walked off is theirs to end)', async () => {
      expect((await signOut(ADMIN_MEMBER_ID)).status).toBe(200);
      expect((await isAdminAuthedWithMember(adminReq())).authed).toBe(false);
    });

    it('a removed admin holds no rank here, so signing them out is an admin’s call', async () => {
      seedMembership('bpm', target.id, { name: 'Viktor', role: 'admin', status: 'removed' });
      expect((await signOut(target.id)).status).toBe(200);
    });
  });

  it('an ORGANISER may sign out an admin or a fellow organiser', async () => {
    seedMembership('bpm', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });
    seedMembership('bpm', target.id, { name: 'Viktor', role: 'admin' });
    const other = seedMember('Carolina');
    seedMembership('bpm', other.id, { name: 'Carolina', role: 'owner' });
    expect((await signOut(target.id)).status).toBe(200);
    expect((await signOut(other.id)).status).toBe(200);
    expect(membershipOf(target.id).sessionsNotBefore).toBeDefined();
    expect(membershipOf(other.id).sessionsNotBefore).toBeDefined();
  });

  it('groups off, every admin is an organiser: an admin signs out another admin', async () => {
    delete process.env[FLAG];
    const other = seedMember('Akane', { role: 'admin' });
    expect((await signOut(other.id)).status).toBe(200);
    expect(memberOf(other.id).sessionsNotBefore).toBeDefined();
  });
});
