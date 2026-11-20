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

  it('moving the ask to an organizer puts it on the card with how the phone signed in', async () => {
    const asked = await ask({});
    await ASK(post('http://x/api/auth/claim-ask', { name: 'Lin', inviteToken: link, secret: asked.secret }, pendingCookie()));
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
