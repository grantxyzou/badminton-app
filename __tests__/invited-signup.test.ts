import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedGroup,
  seedTestAdminMember,
  makeRequest,
  ADMIN_MEMBER_ID,
} from './helpers';
import { NextRequest, NextResponse } from 'next/server';
import { mintInvite } from '../lib/invites';
import { readGroupClaim } from '../lib/auth';
import { setPendingSignup, PENDING_COOKIE } from '../lib/pendingSignup';

/**
 * A STRANGER FOLLOWING AN INVITE MUST NOT LAND ON BPM'S ROSTER.
 *
 * Both signup terminals joined the new account to `resolveGroupId(req)`, which
 * answers BPM for a request carrying no cookie — and a person arriving from
 * `?join=<token>` for another club is exactly that request. They were written
 * onto BPM's roster on their way somewhere else, and `POST /api/groups/join`
 * then added the club they actually wanted, leaving one person on two rosters.
 *
 * These cases are about WHERE THE MEMBERSHIP LANDS, not about whether signup
 * succeeds — signup was always going to return 201. So every assertion reads
 * the `memberships` container rather than the response body, and the BPM cases
 * assert the ABSENCE of a second membership, which is the half that regressed.
 *
 * The flag-off block is not ceremony either: with groups off no membership is
 * written at all, so a token in the body must change nothing rather than refuse
 * — a client on an older deployment should not start failing signups.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';

const { POST: signupRoute } = await import('../app/api/auth/signup/route');
const { POST: completeSignupRoute } = await import('../app/api/auth/complete-signup/route');

const COMPLETE = 'http://localhost:3000/bpm/api/auth/complete-signup';
let ipSeq = 0;

/** A real signed pending cookie, round-tripped through the setter. */
function pendingCookie(): string {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: 'google-sub-invited',
    email: 'carolina@example.com',
    emailVerified: true,
    suggestedName: null,
  });
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${PENDING_COOKIE}=`))!
    .split(';')[0];
}

function completeReq(payload: Record<string, unknown>): NextRequest {
  return new NextRequest(COMPLETE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-IP': `10.8.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
      Cookie: pendingCookie(),
    },
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

type MembershipRow = { groupId: string; memberId: string; name: string; status: string };

const members = () => (getStore()['members'] ?? []) as Array<{ id: string; name: string }>;

const membershipsFor = (name: string): MembershipRow[] =>
  (getStore()['memberships'] ?? [])
    .filter((m): m is MembershipRow => (m as MembershipRow).name === name)
    .filter((m) => m.status === 'active');

function body(over: Record<string, unknown> = {}) {
  return {
    name: 'Carolina',
    email: 'carolina@example.com',
    password: 'a good long password',
    ...over,
  };
}

beforeEach(async () => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env[FLAG] = 'true';
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
  seedGroup('riverside', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Riverside Badminton' });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
  delete process.env[FLAG];
});

describe('an invited email signup joins the club it was invited to', () => {
  it('puts the membership in the invited club and NOT in BPM', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: invite!.token })),
    );
    expect(res.status).toBe(201);

    const rows = membershipsFor('Carolina');
    expect(rows.map((r) => r.groupId)).toEqual(['riverside']);
  });

  it('claims the invited group on the member cookie, not BPM', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: invite!.token })),
    );

    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('member_session='));
    const value = cookie!.slice('member_session='.length).split(';')[0];
    // The claim is only minted for a group the member actually holds, so this
    // reading BPM would mean `addMembership` had gone to the wrong club above.
    expect(readGroupClaim(decodeURIComponent(value))).toBe('riverside');
  });

  it('accepts the typed CODE as well as the link token', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteCode: invite!.code })),
    );
    expect(res.status).toBe(201);
    expect(membershipsFor('Carolina').map((r) => r.groupId)).toEqual(['riverside']);
  });

  it('still joins BPM when no invite came with the request', async () => {
    const res = await signupRoute(makeRequest('POST', SIGNUP, body()));
    expect(res.status).toBe(201);
    expect(membershipsFor('Carolina').map((r) => r.groupId)).toEqual(['bpm']);
  });
});

describe('a token that does not resolve refuses rather than falling back', () => {
  it('answers 404 and creates no member at all', async () => {
    const before = (getStore()['members'] ?? []).length;
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: 'deadbeef'.repeat(4) })),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'invite_not_found' });
    // The refusal has to happen BEFORE the writes, or a bad token leaves an
    // account behind with no club and no way to reach one.
    expect((getStore()['members'] ?? []).length).toBe(before);
    expect(membershipsFor('Carolina')).toEqual([]);
  });

  it('refuses a retired token — regeneration is the revocation', async () => {
    const first = await mintInvite('riverside', ADMIN_MEMBER_ID);
    await mintInvite('riverside', ADMIN_MEMBER_ID); // retires `first`
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: first!.token })),
    );
    expect(res.status).toBe(404);
  });

  it('refuses a token and a code together, the way join does', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: invite!.token, inviteCode: invite!.code })),
    );
    expect(res.status).toBe(404);
  });
});

describe('flag off', () => {
  it('ignores an invite token instead of refusing it', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    delete process.env[FLAG];
    const res = await signupRoute(
      makeRequest('POST', SIGNUP, body({ inviteToken: invite!.token })),
    );
    // 201, and no membership written at all — groups do not exist here.
    expect(res.status).toBe(201);
    expect(membershipsFor('Carolina')).toEqual([]);
  });
});

describe('the Google terminus carries the invite too', () => {
  it('joins the invited club, not the one the request resolves to', async () => {
    const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await completeSignupRoute(
      completeReq({ name: 'Carolina', inviteToken: invite!.token }),
    );
    expect(res.status).toBe(201);
    expect(membershipsFor('Carolina').map((r) => r.groupId)).toEqual(['riverside']);
  });

  it('still joins BPM with no invite', async () => {
    const res = await completeSignupRoute(completeReq({ name: 'Carolina' }));
    expect(res.status).toBe(201);
    expect(membershipsFor('Carolina').map((r) => r.groupId)).toEqual(['bpm']);
  });

  it('refuses a token that does not resolve', async () => {
    const res = await completeSignupRoute(
      completeReq({ name: 'Carolina', inviteToken: 'deadbeef'.repeat(4) }),
    );
    expect(res.status).toBe(404);
    expect(members().filter((m) => m.name === 'Carolina')).toEqual([]);
  });
});
