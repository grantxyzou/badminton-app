import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The account-first club link (docs/plans/one-way-in.md, step 4a).
 *
 * A new person signs in FIRST (Apple, Google or an email code), names
 * themselves, and the account is made in no club with an ask to join the club
 * whose link they used. An organiser lets them in as a regular or a drop-in;
 * that adds THIS account, nothing is created at approval, and the person hears
 * it by email and push. A signed-in member of another club asks the same way.
 */
const pushCalls: Array<{ ids: string[]; title: string; tag?: string }> = [];
vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return {
    ...real,
    sendPushToMembers: vi.fn(async (ids: string[], payload: { title: string; tag?: string }) => {
      pushCalls.push({ ids, title: payload.title, tag: payload.tag });
      return { configured: true, sent: ids.length, failed: 0, removed: 0 };
    }),
  };
});
const mails: Array<{ kind: string; to: string; code?: string; club?: string }> = [];
vi.mock('@/lib/authEmail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/authEmail')>();
  return {
    ...real,
    sendSignInCodeEmail: vi.fn(async (to: string, _name: string, code: string) => {
      mails.push({ kind: 'code', to, code });
      return { sent: true };
    }),
    sendJoinedEmail: vi.fn(async (to: string, _name: string, club: string) => {
      mails.push({ kind: 'joined', to, club });
      return { sent: true };
    }),
  };
});

import { NextResponse } from 'next/server';
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
import { POST as COMPLETE } from '@/app/api/auth/complete-signup/route';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';
import { POST as CODE_START } from '@/app/api/auth/email-code/start/route';
import { POST as CODE_VERIFY } from '@/app/api/auth/email-code/verify/route';
import { GET as MY_ASKS, POST as ASK } from '@/app/api/groups/ask/route';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { rotateClaimLink } from '@/lib/claimLinks';
import { setPendingSignup, PENDING_COOKIE, type PendingSignup } from '@/lib/pendingSignup';
import { lookupIdentity } from '@/lib/authIdentity';
import { readGroupClaim } from '@/lib/auth';
import { decidePage } from '@/lib/pageGate';

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const BASE = 'http://localhost:3000/bpm/api';

type Row = Record<string, unknown>;
const rows = (c: string) => (getStore()[c] ?? []) as Row[];
const memberNamed = (name: string) => rows('members').find((m) => m.name === name) as Row & { id: string };
const membership = (groupId: string, memberId: string) =>
  rows('memberships').find((m) => m.groupId === groupId && m.memberId === memberId && m.kind === undefined) as
    | (Row & { status: string; regular?: boolean })
    | undefined;
const joinRequests = (groupId: string) =>
  ((rows('groups').find((g) => g.id === groupId) as { joinRequests?: Row[] }).joinRequests ?? []) as Array<
    Row & { id: string; askedBy?: string; name: string }
  >;

function pendingCookie(over: Partial<PendingSignup> = {}): string {
  const res = NextResponse.json({});
  setPendingSignup(res, { provider: 'google', sub: 'g-sub-akane', email: 'akane@example.com', emailVerified: true, suggestedName: null, ...over });
  return res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!.split(';')[0];
}
const cookieOf = (res: Response, name: string) => {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`) && !s.startsWith(`${name}=;`));
  return c ? c.split(';')[0] : null;
};
const asOrganiser = { Cookie: `admin_session=${adminCookieValue({ groupId: 'club-x' })}` };

let door: string;

beforeEach(async () => {
  resetMockStore();
  pushCalls.length = 0;
  mails.length = 0;
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant', name: 'BPM Core' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Six Feathers' });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  door = (await rotateClaimLink('club-x', ADMIN_MEMBER_ID))!.token;
});

afterEach(() => {
  delete process.env[FLAG];
});

async function newAccountThroughDoor(name = 'Akane Yamaguchi', over: Partial<PendingSignup> = {}) {
  return COMPLETE(makeRequest('POST', `${BASE}/auth/complete-signup`, { name, inviteToken: door }, { Cookie: pendingCookie(over) }));
}

describe('a new account through the club link', () => {
  it('is made in no club, with an ask to join the club, and the organisers are pushed', async () => {
    const res = await newAccountThroughDoor();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: 'Akane Yamaguchi', asked: { club: 'Six Feathers' } });

    const akane = memberNamed('Akane Yamaguchi');
    expect(membership('club-x', akane.id)).toBeUndefined();
    const [ask] = joinRequests('club-x');
    expect(ask).toMatchObject({ name: 'Akane Yamaguchi', askedBy: akane.id });
    expect(ask.hash).toBeUndefined();
    expect((akane.joinAsks as Row[])[0]).toMatchObject({ groupId: 'club-x', requestId: ask.id });
    expect(pushCalls.some((p) => p.ids.includes(ADMIN_MEMBER_ID) && p.title === 'Someone wants to join')).toBe(true);
  });

  it('can read its own ask as waiting, and nothing else', async () => {
    const res = await newAccountThroughDoor();
    const session = cookieOf(res, 'member_session')!;
    const mine = await MY_ASKS(makeRequest('GET', `${BASE}/groups/ask`, undefined, { Cookie: session }));
    expect(await mine.json()).toEqual({ asks: [{ groupId: 'club-x', club: 'Six Feathers', name: 'Akane Yamaguchi', state: 'waiting' }] });
  });

  it('the page gate shows the waiting account its ask, and no club', async () => {
    const res = await newAccountThroughDoor();
    const session = cookieOf(res, 'member_session')!;
    const page = await decidePage(makeRequest('GET', 'http://localhost:3000/bpm', undefined, { Cookie: session }));
    expect(page).toMatchObject({
      kind: 'no-club',
      memberName: 'Akane Yamaguchi',
      groups: [],
      asks: [{ groupId: 'club-x', club: 'Six Feathers', state: 'waiting' }],
    });
  });

  it('a link that is not live makes no account', async () => {
    const res = await COMPLETE(
      makeRequest('POST', `${BASE}/auth/complete-signup`, { name: 'Akane', inviteToken: 'f'.repeat(32) }, { Cookie: pendingCookie() }),
    );
    expect(res.status).toBe(404);
    expect(memberNamed('Akane')).toBeUndefined();
  });

  it('never makes a password account through the link', async () => {
    const res = await SIGNUP(
      makeRequest('POST', `${BASE}/auth/signup`, { name: 'Akane', email: 'akane@example.com', password: 'a good long password', inviteToken: door }),
    );
    expect(res.status).toBe(404);
    expect(memberNamed('Akane')).toBeUndefined();
  });
});

describe('the organiser lets them in', () => {
  async function askAndList() {
    const res = await newAccountThroughDoor();
    const session = cookieOf(res, 'member_session')!;
    const list = await (await LIST(makeRequest('GET', `${BASE}/admin/access-requests`, undefined, asOrganiser))).json();
    return { session, join: list.joins[0] as { joinRequestId: string; signedIn: boolean; name: string } };
  }

  it('as a regular: the same account joins, as a regular, and hears it by email and push', async () => {
    const { session, join } = await askAndList();
    expect(join).toMatchObject({ name: 'Akane Yamaguchi', signedIn: true });

    const res = await DECIDE(
      makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'approve', regular: true }, asOrganiser),
    );
    expect(res.status).toBe(200);

    const akane = memberNamed('Akane Yamaguchi');
    expect(rows('members').filter((m) => m.name === 'Akane Yamaguchi')).toHaveLength(1);
    expect(membership('club-x', akane.id)).toMatchObject({ status: 'active', regular: true, name: 'Akane Yamaguchi' });
    expect(joinRequests('club-x')).toHaveLength(0);
    expect(mails).toContainEqual({ kind: 'joined', to: 'akane@example.com', club: 'Six Feathers' });
    expect(pushCalls.some((p) => p.ids.includes(akane.id) && p.title === "You're in Six Feathers")).toBe(true);

    const mine = await (await MY_ASKS(makeRequest('GET', `${BASE}/groups/ask`, undefined, { Cookie: session }))).json();
    expect(mine.asks[0]).toMatchObject({ groupId: 'club-x', state: 'in' });
  });

  it('as a drop-in: in the club, not a regular', async () => {
    const { join } = await askAndList();
    await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'approve', regular: false }, asOrganiser));
    const akane = memberNamed('Akane Yamaguchi');
    expect(membership('club-x', akane.id)).toMatchObject({ status: 'active' });
    expect(membership('club-x', akane.id)!.regular).not.toBe(true);
  });

  it('declined: the person reads it as closed, and is in no club', async () => {
    const { session, join } = await askAndList();
    await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'decline' }, asOrganiser));
    const mine = await (await MY_ASKS(makeRequest('GET', `${BASE}/groups/ask`, undefined, { Cookie: session }))).json();
    expect(mine.asks[0]).toMatchObject({ state: 'closed' });
    expect(membership('club-x', memberNamed('Akane Yamaguchi').id)).toBeUndefined();
  });

  it('a name someone in the club already has is refused at approval, and the ask stays', async () => {
    const lin = seedMember('Akane Yamaguchi');
    seedMembership('club-x', lin.id, { name: 'Akane Yamaguchi' });
    const res = await newAccountThroughDoor('Akane Yamaguchi', { sub: 'g-sub-2', email: 'other@example.com' });
    expect(res.status).toBe(201);
    const list = await (await LIST(makeRequest('GET', `${BASE}/admin/access-requests`, undefined, asOrganiser))).json();
    const join = list.joins.find((j: { signedIn: boolean }) => j.signedIn);
    expect(join.nameTaken).toBe(true);
    const decided = await DECIDE(
      makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'approve' }, asOrganiser),
    );
    expect(decided.status).toBe(409);
    expect(joinRequests('club-x').filter((r) => r.askedBy)).toHaveLength(1);
  });
});

describe('a signed-in member asks to join another club', () => {
  it('asks with their own cookie, and is added on approval', async () => {
    const lin = seedMember('Lin');
    seedMembership('bpm', lin.id, { name: 'Lin' });
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` };

    const res = await ASK(makeRequest('POST', `${BASE}/groups/ask`, { doorToken: door, name: 'Lin Dan' }, cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, groupId: 'club-x', club: 'Six Feathers' });

    // Asking again replaces the ask, it does not add one.
    await ASK(makeRequest('POST', `${BASE}/groups/ask`, { doorToken: door, name: 'Lin D' }, cookie));
    const asks = joinRequests('club-x').filter((r) => r.askedBy === lin.id);
    expect(asks).toHaveLength(1);
    expect(asks[0].name).toBe('Lin D');

    await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: asks[0].id, decision: 'approve' }, asOrganiser));
    expect(membership('club-x', lin.id)).toMatchObject({ status: 'active', name: 'Lin D' });
    expect(membership('bpm', lin.id)).toMatchObject({ status: 'active' });
  });

  it('a member already in the club is told so, and nothing is asked', async () => {
    const lin = seedMember('Lin');
    seedMembership('club-x', lin.id, { name: 'Lin' });
    const res = await ASK(
      makeRequest('POST', `${BASE}/groups/ask`, { doorToken: door, name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id, undefined, 'club-x')}` }),
    );
    expect(await res.json()).toMatchObject({ alreadyIn: true });
    expect(joinRequests('club-x')).toHaveLength(0);
  });

  it('refuses without a member cookie, and with a dead link', async () => {
    expect((await ASK(makeRequest('POST', `${BASE}/groups/ask`, { doorToken: door, name: 'Lin' }))).status).toBe(401);
    const lin = seedMember('Lin');
    const res = await ASK(
      makeRequest('POST', `${BASE}/groups/ask`, { doorToken: 'f'.repeat(32), name: 'Lin' }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }),
    );
    expect(res.status).toBe(404);
  });
});

describe('a new account with an email code, through the link', () => {
  it('mails a code only with a live link, and the code parks the address for the name step', async () => {
    // No link: no account can come of it, so no mail.
    await CODE_START(makeRequest('POST', `${BASE}/auth/email-code/start`, { email: 'kento@example.com' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(mails).toHaveLength(0);

    await CODE_START(makeRequest('POST', `${BASE}/auth/email-code/start`, { email: 'kento@example.com', doorToken: door }));
    await vi.waitFor(() => expect(mails).toHaveLength(1));
    const verify = await CODE_VERIFY(makeRequest('POST', `${BASE}/auth/email-code/verify`, { email: 'kento@example.com', code: mails[0].code }));
    expect(verify.status).toBe(200);
    expect(await verify.json()).toEqual({ signup: true });
    const pending = cookieOf(verify, PENDING_COOKIE)!;
    expect(cookieOf(verify, 'member_session')).toBeNull();

    const made = await COMPLETE(makeRequest('POST', `${BASE}/auth/complete-signup`, { name: 'Kento Momota', inviteToken: door }, { Cookie: pending }));
    expect(made.status).toBe(201);
    const kento = memberNamed('Kento Momota');
    expect(kento).toMatchObject({ email: 'kento@example.com', emailVerified: true });
    expect(kento.linkedProviders).toBeUndefined();
    expect((await lookupIdentity('email', 'kento@example.com'))?.memberId).toBe(kento.id);
    expect(joinRequests('club-x')[0]).toMatchObject({ askedBy: kento.id });
    // Signed in, in no club: the cookie names BPM, which they are not in.
    expect(readGroupClaim(decodeURIComponent(cookieOf(made, 'member_session')!.split('=')[1]))).toBe('bpm');
  });

  it('a wrong sign-up code is the same 401, and the code is used once', async () => {
    await CODE_START(makeRequest('POST', `${BASE}/auth/email-code/start`, { email: 'kento@example.com', doorToken: door }));
    await vi.waitFor(() => expect(mails).toHaveLength(1));
    const code = mails[0].code!;
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    const bad = await CODE_VERIFY(makeRequest('POST', `${BASE}/auth/email-code/verify`, { email: 'kento@example.com', code: wrong }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'invalid_code' });
    expect((await CODE_VERIFY(makeRequest('POST', `${BASE}/auth/email-code/verify`, { email: 'kento@example.com', code }))).status).toBe(200);
    expect((await CODE_VERIFY(makeRequest('POST', `${BASE}/auth/email-code/verify`, { email: 'kento@example.com', code }))).status).toBe(401);
  });
});
