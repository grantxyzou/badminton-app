import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  resetMockStore,
  setupAdminPin,
  seedGroup,
  seedMember,
  seedMembership,
  seedTestAdminMember,
  makeRequest,
  ADMIN_MEMBER_ID,
} from './helpers';
import { mintInvite } from '../lib/invites';
import { setPendingSignup, PENDING_COOKIE } from '../lib/pendingSignup';

/**
 * Grant, 2026-10-06: "can we get people to create an account with an invite
 * link. Then they can just create an account and use the service? Admins just
 * get an update on who is new and joined."
 *
 * The first half was already the design (an invite admits a person, no
 * approval step). This is the second half: every admin of the club gets one
 * push when a new account joins by invite, from either sign-up terminal and
 * from the multi-group join route. Best-effort: push failing never fails the
 * sign-up.
 */
const sendPushToMembers = vi.fn(async (..._args: unknown[]) => ({ configured: true, sent: 1, failed: 0, removed: 0 }));
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (...args: unknown[]) => sendPushToMembers(...args),
  sendPushToAll: vi.fn(),
  isPushConfigured: () => true,
}));

const { POST: signupRoute } = await import('../app/api/auth/signup/route');
const { POST: completeSignupRoute } = await import('../app/api/auth/complete-signup/route');
const { POST: joinRoute } = await import('../app/api/groups/join/route');

const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';
const COMPLETE = 'http://localhost:3000/bpm/api/auth/complete-signup';
const JOIN = 'http://localhost:3000/bpm/api/groups/join';
const FLAGS = ['NEXT_PUBLIC_FLAG_MEMBERS_ONLY', 'NEXT_PUBLIC_FLAG_MULTI_GROUP', 'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'] as const;
const saved: Record<string, string | undefined> = {};

let ipSeq = 0;
function completeReq(payload: Record<string, unknown>): NextRequest {
  const res = NextResponse.json({});
  setPendingSignup(res, { provider: 'google', sub: `google-sub-${ipSeq}`, email: `new${ipSeq}@example.com`, emailVerified: true, suggestedName: null });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!.split(';')[0];
  return new NextRequest(COMPLETE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-IP': `10.8.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`, Cookie: cookie },
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/** Who was pushed, and what they were told. */
const pushes = () =>
  sendPushToMembers.mock.calls.map((c) => {
    const [ids, payload] = c as unknown as [string[], { title: string; body: string; url?: string; tag?: string }];
    return { ids: [...ids].sort(), payload };
  });

let secondAdmin: { id: string };
let plainMember: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  sendPushToMembers.mockClear();
  for (const f of FLAGS) saved[f] = process.env[f];
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
  secondAdmin = seedMember('Kento', { role: 'admin' });
  plainMember = seedMember('Akane');
  seedMembership('bpm', secondAdmin.id, { role: 'admin', name: 'Kento' });
  seedMembership('bpm', plainMember.id, { name: 'Akane' });
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe('admins hear about a new member', () => {
  it('email sign-up by invite link: every admin, nobody else, with the name and no email', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, { name: 'Tai Tzu', email: 'tai@example.com', password: 'a good long password', inviteToken: invite!.token }));
    expect(res.status).toBe(201);
    const [p, ...rest] = pushes();
    expect(rest).toEqual([]);
    expect(p.ids).toEqual([ADMIN_MEMBER_ID, secondAdmin.id].sort());
    expect(p.ids).not.toContain(plainMember.id);
    expect(p.payload.body).toContain('Tai Tzu');
    expect(JSON.stringify(p.payload)).not.toContain('tai@example.com');
    expect(p.payload.url).toMatch(/tab=admin/);
  });

  it('Google/Apple sign-up by invite: the same push', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await completeSignupRoute(completeReq({ name: 'Viktor', inviteCode: invite!.code }));
    expect(res.status).toBe(201);
    expect(pushes()).toHaveLength(1);
    expect(pushes()[0].payload.body).toContain('Viktor');
  });

  it('a refused sign-up tells nobody', async () => {
    const res = await signupRoute(makeRequest('POST', SIGNUP, { name: 'Nobody', email: 'nobody@example.com', password: 'a good long password' }));
    expect(res.status).toBe(404);
    expect(pushes()).toEqual([]);
  });

  it('push failing never fails the sign-up', async () => {
    sendPushToMembers.mockRejectedValueOnce(new Error('push down'));
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, { name: 'Sindhu', email: 'sindhu@example.com', password: 'a good long password', inviteToken: invite!.token }));
    expect(res.status).toBe(201);
  });

  describe('with multi-group on', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    });

    it('an existing account joining a club by link tells that club\'s admins once, not on a repeat join', async () => {
      const joiner = seedMember('Lin');
      seedGroup('riverside', { ownerMemberId: secondAdmin.id, name: 'Riverside' });
      seedMembership('riverside', secondAdmin.id, { role: 'owner', name: 'Kento' });
      const invite = await mintInvite('riverside', secondAdmin.id);
      const { memberCookieValue } = await import('./helpers');
      const cookie = `member_session=${memberCookieValue('Lin', joiner.id)}`;
      const join = () => joinRoute(new NextRequest(JOIN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client-IP': `10.7.0.${ipSeq++}`, Cookie: cookie }, body: JSON.stringify({ token: invite!.token }) } as never));
      expect((await join()).status).toBe(200);
      expect(pushes()).toHaveLength(1);
      expect(pushes()[0].ids).toEqual([secondAdmin.id]);
      expect(pushes()[0].payload.body).toContain('Lin');
      expect((await join()).status).toBe(200);
      expect(pushes()).toHaveLength(1);
    });
  });
});
