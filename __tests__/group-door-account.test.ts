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

describe('an imported name: "This is Lin from your list" (step 4b)', () => {
  async function importedLinAsks(holderOver: Record<string, unknown> = {}) {
    const lin = seedMember('Lin Dan', { createdAt: '2025-01-01T00:00:00.000Z', ...holderOver });
    seedMembership('club-x', lin.id, { name: 'Lin Dan', regular: true });
    const res = await newAccountThroughDoor('Lin Dan', { sub: 'g-sub-lin', email: 'lin@example.com' });
    expect(res.status).toBe(201);
    const session = cookieOf(res, 'member_session')!;
    const fresh = rows('members').find((m) => m.name === 'Lin Dan' && m.id !== lin.id) as Row & { id: string };
    const list = await (await LIST(makeRequest('GET', `${BASE}/admin/access-requests`, undefined, asOrganiser))).json();
    const join = list.joins.find((j: { signedIn: boolean }) => j.signedIn) as { joinRequestId: string; linkTo: string | null };
    return { lin, fresh, session, join };
  }

  it('offers the link, and linking moves the sign-in onto the imported Lin, history and all', async () => {
    const { lin, fresh, session, join } = await importedLinAsks();
    expect(join.linkTo).toBe('Lin Dan');

    const res = await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'link' }, asOrganiser));
    expect(res.status).toBe(200);

    // Google now signs in as the imported Lin, who keeps her membership.
    expect((await lookupIdentity('google', 'g-sub-lin'))?.memberId).toBe(lin.id);
    expect((await lookupIdentity('email', 'lin@example.com'))?.memberId).toBe(lin.id);
    const linNow = rows('members').find((m) => m.id === lin.id) as Row;
    expect(linNow).toMatchObject({ email: 'lin@example.com', emailVerified: true, linkedProviders: ['google'] });
    expect(membership('club-x', lin.id)).toMatchObject({ status: 'active', regular: true });
    // The fresh account is retired, in no club, and its ask is gone.
    const freshNow = rows('members').find((m) => m.id === fresh.id) as Row;
    expect(freshNow).toMatchObject({ active: false, mergedInto: lin.id, mergedInGroup: 'club-x' });
    expect(freshNow.email).toBeUndefined();
    expect(membership('club-x', fresh.id)).toBeUndefined();
    expect(joinRequests('club-x')).toHaveLength(0);
    expect(mails).toContainEqual({ kind: 'joined', to: 'lin@example.com', club: 'Six Feathers' });

    // The phone still holding the fresh account's cookie is signed in as Lin, in the club.
    const mine = await MY_ASKS(makeRequest('GET', `${BASE}/groups/ask`, undefined, { Cookie: session }));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ asks: [{ groupId: 'club-x', state: 'in' }], relinked: { name: 'Lin Dan' } });
    const minted = cookieOf(mine, 'member_session')!;
    expect(readGroupClaim(decodeURIComponent(minted.split('=')[1]))).toBe('club-x');
  });

  it('never links to someone who has signed in before', async () => {
    const { join } = await importedLinAsks({ pinHash: 'x' });
    expect(join.linkTo).toBeNull();
    const res = await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'link' }, asOrganiser));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_linkable' });
  });

  it('never merges an account that is already in a club', async () => {
    const lin = seedMember('Lin Dan');
    seedMembership('club-x', lin.id, { name: 'Lin Dan' });
    const kento = seedMember('Kento');
    seedMembership('bpm', kento.id, { name: 'Kento' });
    await ASK(makeRequest('POST', `${BASE}/groups/ask`, { doorToken: door, name: 'Lin Dan' }, { Cookie: `member_session=${memberCookieValue('Kento', kento.id)}` }));
    const ask = joinRequests('club-x').find((r) => r.askedBy === kento.id)!;
    const res = await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: ask.id, decision: 'link' }, asOrganiser));
    expect(res.status).toBe(409);
    expect((await lookupIdentity('google', 'g-sub-lin'))).toBeNull();
    expect(rows('members').find((m) => m.id === kento.id)).toMatchObject({ active: true });
  });

  it('a retired account cannot later be added to another club', async () => {
    const { fresh, join } = await importedLinAsks();
    seedGroup('club-y', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Club Y' });
    seedMembership('club-y', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
    const yDoor = (await rotateClaimLink('club-y', ADMIN_MEMBER_ID))!.token;
    // An ask to Y from the fresh account, made before the link.
    await ASK(makeRequest('POST', `${BASE}/groups/ask`, { doorToken: yDoor, name: 'Lin Dan' }, { Cookie: `member_session=${memberCookieValue('Lin Dan', fresh.id)}` }));
    await DECIDE(makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: join.joinRequestId, decision: 'link' }, asOrganiser));

    const yAsk = joinRequests('club-y').find((r) => r.askedBy === fresh.id)!;
    const res = await DECIDE(
      makeRequest('POST', `${BASE}/admin/access-requests`, { joinRequestId: yAsk.id, decision: 'approve' }, { Cookie: `admin_session=${adminCookieValue({ groupId: 'club-y' })}` }),
    );
    expect(res.status).toBe(404);
    expect(membership('club-y', fresh.id)).toBeUndefined();
  });
});
