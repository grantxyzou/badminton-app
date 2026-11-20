import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST as ASK } from '@/app/api/auth/claim-ask/route';
import { GET as PROMPTS, POST as ANSWER } from '@/app/api/auth/new-phone/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { GET as LIST, POST as DECIDE } from '@/app/api/admin/access-requests/route';
import { rotateClaimLink } from '@/lib/claimLinks';
import { setPendingSignup, PENDING_COOKIE, type PendingSignup } from '@/lib/pendingSignup';
import { lookupIdentity } from '@/lib/authIdentity';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  setupAdminPin,
  seedTestAdminMember,
  adminCookieValue,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * "Is that you?" without a PIN (docs/plans/sign-in-redesign.md, step 3): a
 * new sign-in that chose a member's name asks any phone where that person is
 * still signed in (tap the number the new phone shows), else an organizer.
 * Either yes links the new sign-in to the account, and the waiting page
 * signs in. Two clubs, each with a Lin, so only the club's link can tell
 * which Lin is meant.
 */

const sendPushToMembers = vi.fn();
vi.mock('@/lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/push')>()),
  sendPushToMembers: (...args: unknown[]) => sendPushToMembers(...args),
}));

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const X = 'club-x';
const Y = 'club-y';
let ip = 0;
const flush = () => new Promise((r) => setTimeout(r, 20));
let link = '';

function pendingCookie(over: Partial<PendingSignup> = {}): string {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: 'google-new-phone',
    email: 'lin.new@example.com',
    emailVerified: true,
    suggestedName: null,
    ...over,
  });
  return res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!.split(';')[0];
}

function post(url: string, body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Client-IP': `10.77.${Math.floor(ip / 250)}.${ip++ % 250}` };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) } as any);
}

function get(url: string, cookie: string): NextRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, { method: 'GET', headers: { Cookie: cookie, 'X-Client-IP': `10.78.0.${ip++ % 250}` } } as any);
}

const linX = 'm-lin-x';
const linY = 'm-lin-y';
const asLinX = () => `member_session=${memberCookieValue('Lin', linX, undefined, X)}`;
const asLinY = () => `member_session=${memberCookieValue('Lin', linY, undefined, Y)}`;

type Asked = { ok: true; secret: string; match: number; club: string | null };

async function ask(body: Record<string, unknown>, cookie = pendingCookie()): Promise<Asked> {
  const res = await ASK(post('http://x/api/auth/claim-ask', { name: 'Lin', inviteToken: link, ...body }, cookie));
  expect(res.status).toBe(200);
  return res.json();
}

const openOn = (id: string) =>
  ((getStore().members as Array<{ id: string; accessRequests?: Array<Record<string, unknown>> }>).find((m) => m.id === id)?.accessRequests ?? []);

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  await seedTestAdminMember({ membership: false });
  seedGroup(X, { name: 'Club X', ownerMemberId: ADMIN_MEMBER_ID });
  seedGroup(Y, { name: 'Club Y', ownerMemberId: ADMIN_MEMBER_ID });
  seedMember('Lin', { id: linX });
  seedMembership(X, linX, { name: 'Lin' });
  seedMember('Lin', { id: linY });
  seedMembership(Y, linY, { name: 'Lin' });
  link = (await rotateClaimLink(X, ADMIN_MEMBER_ID))!.token;
});
afterEach(() => {
  delete process.env[FLAG];
  sendPushToMembers.mockReset();
});

describe('asking the other phone', () => {
  it('stores the ask on the Lin the link names, and pushes only her', async () => {
    const asked = await ask({});
    expect(asked.club).toBe(X);
    expect(asked.match).toBeGreaterThanOrEqual(10);
    const [stored] = openOn(linX);
    expect(stored.link).toMatchObject({ provider: 'google', sub: 'google-new-phone' });
    expect(stored.choices).toContain(asked.match);
    expect(openOn(linY)).toEqual([]);
    expect(sendPushToMembers.mock.calls.map((c) => c[0])).toEqual([[linX]]);
  });

  it('asks again by replacing, never piling up', async () => {
    await ask({});
    await ask({});
    expect(openOn(linX)).toHaveLength(1);
  });

  it('a name nobody holds gets the same answer, and nothing is stored or sent', async () => {
    const res = await ASK(post('http://x/api/auth/claim-ask', { name: 'Nobody', inviteToken: link }, pendingCookie()));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['club', 'match', 'ok', 'secret']);
    await flush(); // pushes go out in the background: give one time to land
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('needs the new sign-in: no pending cookie, no ask', async () => {
    const res = await ASK(post('http://x/api/auth/claim-ask', { name: 'Lin', inviteToken: link }));
    expect(res.status).toBe(400);
    expect(openOn(linX)).toEqual([]);
  });

  it('her phone sees three numbers, not which one is right; another Lin sees nothing', async () => {
    const asked = await ask({});
    const mine = await (await PROMPTS(get('http://x/api/auth/new-phone', asLinX()))).json();
    expect(mine.asks).toHaveLength(1);
    expect(mine.asks[0]).toMatchObject({ provider: 'google', email: 'lin.new@example.com' });
    expect(mine.asks[0].choices).toContain(asked.match);
    expect(mine.asks[0].match).toBeUndefined();
    const theirs = await (await PROMPTS(get('http://x/api/auth/new-phone', asLinY()))).json();
    expect(theirs.asks).toEqual([]);
  });

  it('signed out, nobody can list or answer', async () => {
    await ask({});
    expect((await PROMPTS(get('http://x/api/auth/new-phone', ''))).status).toBe(401);
    const id = openOn(linX)[0].id as string;
    expect((await ANSWER(post('http://x/api/auth/new-phone', { id, pick: 10 }))).status).toBe(401);
  });

  it('a wrong number ends the ask and links nothing', async () => {
    const asked = await ask({});
    const id = openOn(linX)[0].id as string;
    const wrong = (openOn(linX)[0].choices as number[]).find((n) => n !== asked.match)!;
    const res = await ANSWER(post('http://x/api/auth/new-phone', { id, pick: wrong }, asLinX()));
    expect((await res.json()).outcome).toBe('stopped');
    expect(openOn(linX)).toEqual([]);
    expect(await lookupIdentity('google', 'google-new-phone')).toBeNull();
  });

  it('"Not me" ends it too', async () => {
    await ask({});
    const id = openOn(linX)[0].id as string;
    await ANSWER(post('http://x/api/auth/new-phone', { id, notMe: true }, asLinX()));
    expect(openOn(linX)).toEqual([]);
  });

  it('another member cannot answer her ask', async () => {
    await ask({});
    const id = openOn(linX)[0].id as string;
    const res = await ANSWER(post('http://x/api/auth/new-phone', { id, pick: 10 }, asLinY()));
    expect(res.status).toBe(404);
    expect(openOn(linX)).toHaveLength(1);
  });

  it('the right number links the new sign-in, and the waiting page signs in as her', async () => {
    const asked = await ask({});
    const id = openOn(linX)[0].id as string;
    const yes = await ANSWER(post('http://x/api/auth/new-phone', { id, pick: asked.match }, asLinX()));
    expect((await yes.json()).outcome).toBe('approved');
    expect((await lookupIdentity('google', 'google-new-phone'))?.memberId).toBe(linX);

    const claim = await CLAIM(post('http://x/api/members/access-request/claim', { name: 'Lin', secret: asked.secret, club: asked.club }));
    const body = await claim.json();
    expect(body.status).toBe('approved');
    const cookies = claim.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/member_session=/);
    expect(cookies).toMatch(new RegExp(`${PENDING_COOKIE}=;`));
  });
});

describe('asking an organizer', () => {
  const asOrganizer = () => {
    seedMembership(X, ADMIN_MEMBER_ID, { name: 'Organizer X', role: 'owner' });
    return `admin_session=${adminCookieValue({ groupId: X })}`;
  };

  it('a phone-only ask is not on the card, and not approvable by its id', async () => {
    await ask({});
    const cookie = asOrganizer();
    const listed = await (await LIST(get('http://x/api/admin/access-requests', cookie))).json();
    expect(listed.requests).toEqual([]);
    const id = openOn(linX)[0].id as string;
    const res = await DECIDE(post('http://x/api/admin/access-requests', { memberId: linX, requestId: id, decision: 'approve' }, cookie));
    expect(res.status).toBe(404);
    expect(await lookupIdentity('google', 'google-new-phone')).toBeNull();
  });

  it('asking an organizer instead replaces the phone ask, and puts it on the card with how the phone signed in', async () => {
    await ask({});
    await ask({ organizer: true });
    expect(openOn(linX)).toHaveLength(1);
    expect(openOn(linX)[0].organizer).toBe(true);
    const cookie = asOrganizer();
    const listed = await (await LIST(get('http://x/api/admin/access-requests', cookie))).json();
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0].newSignIn).toEqual({ provider: 'google', email: 'lin.new@example.com' });
  });

  it("an organizer's yes links the sign-in, and the waiting page signs in", async () => {
    const asked = await ask({ organizer: true });
    const cookie = asOrganizer();
    const id = openOn(linX)[0].id as string;
    const res = await DECIDE(post('http://x/api/admin/access-requests', { memberId: linX, requestId: id, decision: 'approve' }, cookie));
    expect(res.status).toBe(200);
    expect((await lookupIdentity('google', 'google-new-phone'))?.memberId).toBe(linX);
    const claim = await CLAIM(post('http://x/api/members/access-request/claim', { name: 'Lin', secret: asked.secret, club: asked.club }));
    expect((await claim.json()).status).toBe('approved');
  });

  it("the other club's organizer never sees it", async () => {
    await ask({ organizer: true });
    seedMembership(Y, ADMIN_MEMBER_ID, { name: 'Organizer Y', role: 'owner' });
    const cookie = `admin_session=${adminCookieValue({ groupId: Y })}`;
    const listed = await (await LIST(get('http://x/api/admin/access-requests', cookie))).json();
    expect(listed.requests).toEqual([]);
  });
});

/**
 * The security review of step 3 (2026-11-20): the number alone made a blind
 * tap one in three, and nothing limited how often a stranger could prompt.
 * The limit is per PERSON (lib/newPhoneGuard.ts); an approval on the card is
 * an organizer's; and an approval never touches the person's own address.
 */
describe('how often, and who may say yes', () => {
  const other = (sub: string) => pendingCookie({ sub, email: `${sub}@example.com` });
  const asOrganizer = () => {
    seedMembership(X, ADMIN_MEMBER_ID, { name: 'Organizer X', role: 'owner' });
    return `admin_session=${adminCookieValue({ groupId: X })}`;
  };

  it('after "No, it\'s not me", no new ask for a day, from any phone, with the same answer', async () => {
    await ask({});
    const id = openOn(linX)[0].id as string;
    await ANSWER(post('http://x/api/auth/new-phone', { id, notMe: true }, asLinX()));
    sendPushToMembers.mockReset();
    const again = await ask({}, other('google-someone-else'));
    expect(Object.keys(again).sort()).toEqual(['club', 'match', 'ok', 'secret']);
    expect(openOn(linX)).toEqual([]);
    await flush(); // pushes go out in the background: give one time to land
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('one waiting ask at a time: a second new phone stores nothing', async () => {
    await ask({});
    sendPushToMembers.mockReset();
    await ask({}, other('google-second'));
    expect(openOn(linX)).toHaveLength(1);
    expect((openOn(linX)[0].link as { sub: string }).sub).toBe('google-new-phone');
    await flush(); // pushes go out in the background: give one time to land
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('at most three asks a day, each a prompt', async () => {
    for (let i = 0; i < 3; i++) await ask({});
    sendPushToMembers.mockReset();
    await ask({});
    await flush(); // pushes go out in the background: give one time to land
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('a club admin who is not an organizer cannot approve a new sign-in', async () => {
    await ask({ organizer: true });
    seedMembership(X, ADMIN_MEMBER_ID, { name: 'Admin X', role: 'admin' });
    const cookie = `admin_session=${adminCookieValue({ groupId: X })}`;
    const id = openOn(linX)[0].id as string;
    const res = await DECIDE(post('http://x/api/admin/access-requests', { memberId: linX, requestId: id, decision: 'approve' }, cookie));
    expect(res.status).toBe(403);
    expect(await lookupIdentity('google', 'google-new-phone')).toBeNull();
  });

  it("an approval never touches the person's own address, and tells them a way in was added", async () => {
    const lin = (getStore().members as Array<{ id: string; email?: string }>).find((m) => m.id === linX)!;
    lin.email = 'lin@own.example';
    const { reserveIdentity } = await import('@/lib/authIdentity');
    await reserveIdentity('email', 'lin@own.example', linX);
    await ask({ organizer: true });
    sendPushToMembers.mockReset();
    const id = openOn(linX)[0].id as string;
    await DECIDE(post('http://x/api/admin/access-requests', { memberId: linX, requestId: id, decision: 'approve' }, asOrganizer()));
    expect((await lookupIdentity('google', 'google-new-phone'))?.memberId).toBe(linX);
    expect(lin.email).toBe('lin@own.example');
    expect((await lookupIdentity('email', 'lin@own.example'))?.memberId).toBe(linX);
    expect(await lookupIdentity('email', 'lin.new@example.com')).toBeNull();
    expect(sendPushToMembers.mock.calls.map((c) => c[0])).toContainEqual([linX]);
  });

  it("a new phone asking her own phone still counts: two devices at once are never approvable (F2)", async () => {
    await ask({});
    const { issueAccessRequest } = await import('@/lib/accessRequest');
    const lin = (getStore().members as Array<{ id: string; accessRequests: unknown[] }>).find((m) => m.id === linX)!;
    lin.accessRequests.push(issueAccessRequest({ groupId: X }).stored);
    const listed = await (await LIST(get('http://x/api/admin/access-requests', asOrganizer()))).json();
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0].count).toBe(2);
    expect(listed.requests[0].requestId).toBeNull();
  });

  it("a stranger spending her three phone asks does not shut her out of the organizer", async () => {
    asOrganizer(); // the club has an organizer to hear it
    for (let i = 0; i < 3; i++) await ask({}, other('google-stranger'));
    // Her own new phone, a different sign-in: the phone rung is spent...
    sendPushToMembers.mockReset();
    await ask({}, other('google-real-lin'));
    await flush(); // pushes go out in the background: give one time to land
    expect(sendPushToMembers).not.toHaveBeenCalled();
    // ...but an organizer ask is stored, and the organizers hear it once a day.
    await ask({ organizer: true }, other('google-real-lin'));
    expect(openOn(linX).some((r) => (r.link as { sub: string }).sub === 'google-real-lin' && r.organizer === true)).toBe(true);
    // The push is not awaited by the route (timing): wait for it to go out.
    await vi.waitFor(() => expect(sendPushToMembers).toHaveBeenCalledTimes(1));
    await ask({ organizer: true }, other('google-real-lin'));
    await new Promise((r) => setTimeout(r, 20));
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
  });

  it('an approved ask whose sign-in is not linked yet does not sign the phone in', async () => {
    const asked = await ask({ organizer: true });
    const lin = (getStore().members as Array<{ id: string; accessRequests: Array<Record<string, unknown>> }>).find((m) => m.id === linX)!;
    lin.accessRequests[0].approvedAt = Date.now(); // approved, the link not yet written
    const claim = await CLAIM(post('http://x/api/members/access-request/claim', { name: 'Lin', secret: asked.secret, club: asked.club }));
    expect((await claim.json()).status).toBe('pending');
    expect(claim.headers.getSetCookie().join('\n')).not.toMatch(/member_session=/);
  });

  it('"No, it\'s not me" after an organizer\'s yes takes the sign-in and its address back', async () => {
    await ask({ organizer: true });
    const id = openOn(linX)[0].id as string;
    await DECIDE(post('http://x/api/admin/access-requests', { memberId: linX, requestId: id, decision: 'approve' }, asOrganizer()));
    expect((await lookupIdentity('google', 'google-new-phone'))?.memberId).toBe(linX);
    expect(openOn(linX)[0].addedEmail).toBe('lin.new@example.com');
    const res = await ANSWER(post('http://x/api/auth/new-phone', { id, notMe: true }, asLinX()));
    expect((await res.json()).outcome).toBe('undone');
    expect(await lookupIdentity('google', 'google-new-phone')).toBeNull();
    expect(await lookupIdentity('email', 'lin.new@example.com')).toBeNull();
    const lin = (getStore().members as Array<{ id: string; email?: string; linkedProviders?: string[] }>).find((m) => m.id === linX)!;
    expect(lin.email).toBeUndefined();
    expect(lin.linkedProviders ?? []).not.toContain('google');
    expect(openOn(linX)).toEqual([]);
  });
});

/** Third review (2026-11-20): an organizer ask must put nothing tappable on
 *  the person's phone, nor hold the phone rung's one waiting slot. */
describe('an organizer ask stays off her phone', () => {
  it('carries no numbers, is not listed on her phone, and cannot be answered by one', async () => {
    const asked = await ask({ organizer: true });
    expect(asked.match).toBeUndefined();
    const [stored] = openOn(linX);
    expect(stored.choices).toBeUndefined();
    const mine = await (await PROMPTS(get('http://x/api/auth/new-phone', asLinX()))).json();
    expect(mine.asks).toEqual([]);
    const res = await ANSWER(post('http://x/api/auth/new-phone', { id: stored.id, pick: 10 }, asLinX()));
    expect(res.status).toBe(404);
  });

  it("a stranger's organizer ask does not block her own phone ask", async () => {
    await ask({ organizer: true }, pendingCookie({ sub: 'google-stranger', email: 'x@example.com' }));
    sendPushToMembers.mockReset();
    await ask({});
    await vi.waitFor(() => expect(sendPushToMembers.mock.calls.map((c) => c[0])).toContainEqual([linX]));
    expect(openOn(linX)).toHaveLength(2);
  });

  it('an address that was already hers is never recorded as added', async () => {
    const { linkSignInTo } = await import('@/lib/linkSignIn');
    const { reserveIdentity } = await import('@/lib/authIdentity');
    await reserveIdentity('email', 'lin.new@example.com', linX); // hers already, no email field
    const linked = await linkSignInTo(linX, { provider: 'google', sub: 'g-2', email: 'lin.new@example.com', emailVerified: true });
    expect(linked.ok && linked.addedEmail).toBeNull();
  });
});
