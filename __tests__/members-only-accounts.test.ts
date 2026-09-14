import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedGroup,
  seedMember,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { mintInvite } from '../lib/invites';
import { setPendingSignup, PENDING_COOKIE } from '../lib/pendingSignup';

/**
 * MEMBERS ONLY, PART 2 (docs/plans/members-only.md): an account needs an
 * invite, and a session sign-up needs an account.
 *
 * Grant, 2026-09-13: "People shouldn't be allowed to sign up when they don't
 * have an account." And the reason part 1 alone was not enough: with the
 * multi-group flag off, anyone could create an account with an email address,
 * and an account IS membership of the only club there is. Hiding club data from
 * signed-out visitors protected nothing while signing in was open to all.
 *
 * Everything here runs with MULTI_GROUP OFF — production's setting — unless a
 * case says otherwise.
 */

const { POST: signupRoute } = await import('../app/api/auth/signup/route');
const { POST: completeSignupRoute } = await import('../app/api/auth/complete-signup/route');
const { GET: inviteRoute } = await import('../app/api/groups/invite/route');
const { GET: previewRoute } = await import('../app/api/groups/preview/route');
const { POST: playersPOST } = await import('../app/api/players/route');

const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';
const COMPLETE = 'http://localhost:3000/bpm/api/auth/complete-signup';
const GROUPS = 'http://localhost:3000/bpm/api/groups';
const PLAYERS = 'http://localhost:3000/bpm/api/players';

const FLAGS = ['NEXT_PUBLIC_FLAG_MEMBERS_ONLY', 'NEXT_PUBLIC_FLAG_MULTI_GROUP', 'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'] as const;
const saved: Record<string, string | undefined> = {};

const membersNamed = (name: string) =>
  ((getStore()['members'] ?? []) as Array<{ name: string }>).filter((m) => m.name === name);

const playersNamed = (name: string) =>
  ((getStore()['players'] ?? []) as Array<{ name: string; removed?: boolean }>).filter(
    (p) => p.name === name && !p.removed,
  );

function signupBody(over: Record<string, unknown> = {}) {
  return { name: 'Carolina', email: 'carolina@example.com', password: 'a good long password', ...over };
}

let ipSeq = 0;
function completeReq(payload: Record<string, unknown>): NextRequest {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: `google-sub-${ipSeq}`,
    email: `carolina${ipSeq}@example.com`,
    emailVerified: true,
    suggestedName: null,
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!.split(';')[0];
  return new NextRequest(COMPLETE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-IP': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
      Cookie: cookie,
    },
    body: JSON.stringify(payload),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  for (const f of FLAGS) saved[f] = process.env[f];
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY = 'true';
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  await seedTestAdminMember();
  seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, name: 'BPM Badminton' });
  seedGroup('riverside', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Riverside Badminton' });
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe('a new account needs an invite', () => {
  it('email sign-up with no invite is refused, and creates nobody', async () => {
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('invite_not_found');
    expect(membersNamed('Carolina')).toEqual([]);
  });

  it('email sign-up with BPM\'s invite LINK creates the account', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ inviteToken: invite!.token })));
    expect(res.status).toBe(201);
    expect(membersNamed('Carolina')).toHaveLength(1);
  });

  it('email sign-up with BPM\'s typed CODE creates the account', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ inviteCode: invite!.code })));
    expect(res.status).toBe(201);
  });

  it('a retired invite is refused — regenerating is the revocation', async () => {
    const old = await mintInvite('bpm', ADMIN_MEMBER_ID);
    await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ inviteToken: old!.token })));
    expect(res.status).toBe(404);
    expect(membersNamed('Carolina')).toEqual([]);
  });

  it('with groups off, ANOTHER club\'s invite does not mint a BPM account', async () => {
    const foreign = await mintInvite('riverside', ADMIN_MEMBER_ID);
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ inviteToken: foreign!.token })));
    expect(res.status).toBe(404);
    expect(membersNamed('Carolina')).toEqual([]);
  });

  it('noGroup does not stand in for an invite while groups are off', async () => {
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ noGroup: true })));
    expect(res.status).toBe(404);
  });

  it('the Google/Apple new-account step refuses without an invite', async () => {
    const res = await completeSignupRoute(completeReq({ name: 'Carolina' }));
    expect(res.status).toBe(404);
    expect(membersNamed('Carolina')).toEqual([]);
  });

  it('the Google/Apple new-account step accepts BPM\'s invite', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await completeSignupRoute(completeReq({ name: 'Carolina', inviteToken: invite!.token }));
    expect(res.status).toBe(201);
  });

  it('flag off: an uninvited sign-up is accepted, exactly as before', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
    const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody()));
    expect(res.status).toBe(201);
  });

  describe('with multi-group on as well', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    });

    it('still refuses an uninvited front-door sign-up', async () => {
      const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody()));
      expect(res.status).toBe(404);
    });

    it('allows creating your OWN club (noGroup), which joins no roster', async () => {
      const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ noGroup: true })));
      expect(res.status).toBe(201);
      const rows = ((getStore()['memberships'] ?? []) as Array<{ name: string }>).filter((m) => m.name === 'Carolina');
      expect(rows).toEqual([]);
    });

    it('an invite to another club joins that club', async () => {
      const invite = await mintInvite('riverside', ADMIN_MEMBER_ID);
      const res = await signupRoute(makeRequest('POST', SIGNUP, signupBody({ inviteToken: invite!.token })));
      expect(res.status).toBe(201);
    });
  });
});

describe('the invite surfaces exist with only one club', () => {
  it('the admin can read BPM\'s link and code', async () => {
    const res = await inviteRoute(makeAdminRequest('GET', `${GROUPS}/invite`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('a signed-out visitor can preview a valid invite — the club name and nothing else', async () => {
    const invite = await mintInvite('bpm', ADMIN_MEMBER_ID);
    const res = await previewRoute(makeRequest('GET', `${GROUPS}/preview?token=${invite!.token}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'BPM Badminton' });
  });

  it('both flags off: the invite surfaces do not exist', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
    expect((await inviteRoute(makeAdminRequest('GET', `${GROUPS}/invite`))).status).toBe(404);
    expect((await previewRoute(makeRequest('GET', `${GROUPS}/preview?token=${'a'.repeat(32)}`))).status).toBe(404);
  });
});

describe('a session sign-up needs an account', () => {
  const sessionId = 'session-2026-09-17';

  beforeEach(() => {
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 12, signupOpen: true });
    seedMember('Lin', { id: 'member-lin' });
    seedMember('Viktor', { id: 'member-viktor' });
  });

  const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}` });

  it('no cookie: 401, and nobody is put on the list', async () => {
    const res = await playersPOST(makeRequest('POST', PLAYERS, { name: 'Lin' }));
    expect(res.status).toBe(401);
    expect(playersNamed('Lin')).toEqual([]);
  });

  it('no cookie: the refusal never says whether the name exists', async () => {
    // Name-only sign-ups used to answer invite_list_not_found for a stranger's
    // name and something else for a member's. Both are now the same 401.
    const member = await playersPOST(makeRequest('POST', PLAYERS, { name: 'Lin' }));
    const stranger = await playersPOST(makeRequest('POST', PLAYERS, { name: 'Nobody Atall' }));
    expect(member.status).toBe(stranger.status);
    expect(await member.json()).toEqual(await stranger.json());
  });

  it('signs up the cookie\'s member and ignores the body\'s name', async () => {
    const res = await playersPOST(makeRequest('POST', PLAYERS, { name: 'Viktor' }, asLin()));
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Lin');
    expect(playersNamed('Lin')).toHaveLength(1);
    expect(playersNamed('Viktor')).toEqual([]);
  });

  it('works with no name in the body at all', async () => {
    const res = await playersPOST(makeRequest('POST', PLAYERS, {}, asLin()));
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Lin');
  });

  it('a REMOVED member\'s live cookie is refused', async () => {
    const lin = (getStore()['members'] as Array<{ id: string; active: boolean }>).find((m) => m.id === 'member-lin')!;
    lin.active = false;
    const res = await playersPOST(makeRequest('POST', PLAYERS, {}, asLin()));
    expect(res.status).toBe(401);
  });

  it('a renamed member signs up under their CURRENT name, not the cookie\'s', async () => {
    const lin = (getStore()['members'] as Array<{ id: string; name: string }>).find((m) => m.id === 'member-lin')!;
    lin.name = 'Lin Dan';
    const res = await playersPOST(makeRequest('POST', PLAYERS, {}, asLin()));
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Lin Dan');
  });

  it('an admin still signs anyone up by name', async () => {
    const res = await playersPOST(makeAdminRequest('POST', PLAYERS, { name: 'Viktor' }));
    expect(res.status).toBe(201);
    expect(playersNamed('Viktor')).toHaveLength(1);
  });

  it('limits sign-ups PER MEMBER, whichever address they come from', async () => {
    // Every request gets a fresh IP from makeRequest, so the per-IP limit never
    // fires here; only the per-member one can produce the 429.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await playersPOST(makeRequest('POST', PLAYERS, {}, asLin()));
      statuses.push(res.status);
    }
    expect(statuses[10]).toBe(429);
  });

  it('flag off: a name-only sign-up for a member works, exactly as before', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_MEMBERS_ONLY;
    const res = await playersPOST(makeRequest('POST', PLAYERS, { name: 'Lin' }));
    expect(res.status).toBe(201);
  });
});
