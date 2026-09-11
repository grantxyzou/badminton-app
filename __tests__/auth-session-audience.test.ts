import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import {
  isAdminAuthed,
  isAdminAuthedWithMember,
  verifyMemberAuth,
  readGroupClaim,
  setAdminCookie,
  setMemberCookie,
} from '@/lib/auth';
import {
  resetMockStore,
  seedTestAdminMember,
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  getTestAdminName,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * THE TWO COOKIES ARE NOT INTERCHANGEABLE.
 *
 * One `SESSION_SECRET` signs both, over the same payload shape, so for a while
 * the only thing separating a member session from an admin one was the cookie
 * NAME the client chose to put the value in — and the client chooses that. Any
 * signed-in member (sign-up mints a `member_session` with no PIN) could copy
 * their own token out of devtools, send it back as `admin_session`, and pass
 * `isAdminAuthed` — the read-only admin gate on aliases, the admin dashboards,
 * every other member's Stats via `ownsNameOrAdmin`, and the rule-7 sessionId
 * overrides that write.
 *
 * The binding is the `typ` claim INSIDE the signature. These cases fix both
 * halves of the contract: an admin token must SAY it is one, and a token that
 * says nothing (minted before the field existed) is a MEMBER token — which
 * keeps live member sessions working and fails closed for admin.
 *
 * The seeded member is a real active admin, so every refusal below is the
 * audience check and nothing else; drop `typ` from `verifyToken` and these
 * cases go green again.
 */
const SECRET = 'test-session-secret-not-for-production-use-please';

const withCookie = (cookie: string) =>
  makeRequest('GET', 'http://localhost:3000/api/aliases', undefined, { Cookie: cookie });

/** The member token a signed-in admin's own device holds. */
const memberTokenForAdmin = () => memberCookieValue(getTestAdminName(), ADMIN_MEMBER_ID);

beforeEach(async () => {
  process.env.SESSION_SECRET = SECRET;
  resetMockStore();
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
});

describe('a member token replayed under the admin cookie name', () => {
  it('is refused by the sync admin check', () => {
    const req = withCookie(`admin_session=${memberTokenForAdmin()}`);
    expect(isAdminAuthed(req)).toBe(false);
  });

  it('is refused by the async admin check too, role re-check notwithstanding', async () => {
    const req = withCookie(`admin_session=${memberTokenForAdmin()}`);
    expect(await isAdminAuthedWithMember(req)).toEqual({ authed: false });
  });

  it('is refused even when it is the cookie this app just minted', () => {
    const res = NextResponse.json({});
    setMemberCookie(res, ADMIN_MEMBER_ID, getTestAdminName());
    const value = (res.headers.get('set-cookie') ?? '').match(/member_session=([^;]+)/)?.[1] ?? '';
    expect(value).not.toBe('');
    expect(isAdminAuthed(withCookie(`admin_session=${value}`))).toBe(false);
  });
});

describe('a token from before the audience field existed', () => {
  const legacy = () => memberCookieValue(getTestAdminName(), ADMIN_MEMBER_ID, 3600, 'bpm', null);

  it('does NOT pass an admin check — fail closed, so a pre-deploy admin re-PINs once', async () => {
    const req = withCookie(`admin_session=${legacy()}`);
    expect(isAdminAuthed(req)).toBe(false);
    expect(await isAdminAuthedWithMember(req)).toEqual({ authed: false });
  });

  it('still authenticates as a member — no live 30-day member_session is invalidated', () => {
    const req = withCookie(`member_session=${legacy()}`);
    expect(verifyMemberAuth(req)).toEqual({
      memberId: ADMIN_MEMBER_ID,
      name: getTestAdminName(),
      groupId: 'bpm',
    });
  });
});

describe('the credential each check is actually for', () => {
  it('a freshly minted admin cookie still passes both admin checks', async () => {
    const res = NextResponse.json({});
    setAdminCookie(res, ADMIN_MEMBER_ID, getTestAdminName());
    const value = (res.headers.get('set-cookie') ?? '').match(/admin_session=([^;]+)/)?.[1] ?? '';
    const req = withCookie(`admin_session=${value}`);
    expect(isAdminAuthed(req)).toBe(true);
    expect((await isAdminAuthedWithMember(req)).authed).toBe(true);
  });

  it('an admin token replayed under the member cookie name is not a member session', () => {
    const req = withCookie(`member_session=${adminCookieValue()}`);
    expect(verifyMemberAuth(req)).toBeNull();
  });

  it('readGroupClaim reads either cookie: POST /api/admin mints only the admin one', () => {
    expect(readGroupClaim(adminCookieValue({ groupId: 'club-x' }))).toBe('club-x');
    expect(readGroupClaim(memberCookieValue('Lin', 'm1', 3600, 'club-x'))).toBe('club-x');
  });
});
