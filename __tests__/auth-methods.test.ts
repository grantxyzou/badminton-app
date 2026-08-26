import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, seedMember, setupAdminPin, memberCookieValue, getStore } from './helpers';
import { GET } from '../app/api/auth/methods/route';
import { POST as dismissNudge } from '../app/api/auth/nudge/route';
import { reserveIdentity } from '../lib/authIdentity';

const METHODS = 'http://localhost:3000/bpm/api/auth/methods';
const NUDGE = 'http://localhost:3000/bpm/api/auth/nudge';
let ipSeq = 0;

const savedEnv = {
  gid: process.env.GOOGLE_CLIENT_ID,
  gsec: process.env.GOOGLE_CLIENT_SECRET,
};

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  // Apple deliberately left unconfigured.
  delete process.env.APPLE_CLIENT_ID;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
  if (savedEnv.gid === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = savedEnv.gid;
  if (savedEnv.gsec === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = savedEnv.gsec;
});

function req(url: string, cookie?: string, method = 'GET'): NextRequest {
  const headers: Record<string, string> = {
    'X-Client-IP': `10.3.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, { method, headers } as any);
}

function asMember(name: string, id: string): string {
  return `member_session=${memberCookieValue(name, id)}`;
}

describe('GET /api/auth/methods', () => {
  it('reports only the providers this deployment configured', async () => {
    const res = await GET(req(METHODS));
    const body = await res.json();
    expect(body.available).toEqual(['google']);
  });

  it('answers for an anonymous caller without erroring', async () => {
    // The sign-in surface needs `available` to draw its buttons before anyone
    // is signed in, so anonymous is a legitimate state rather than a 401.
    const body = await (await GET(req(METHODS))).json();
    expect(body.linked).toEqual([]);
    expect(body.hasPassword).toBe(false);
  });

  it("reports the CALLER's own inventory, keyed on the cookie", async () => {
    const me = seedMember('Lin', { pinHash: 'x', email: 'lin@example.com', emailVerified: true });
    await reserveIdentity('google', 'sub-lin', me.id);

    const body = await (await GET(req(METHODS, asMember('Lin', me.id)))).json();
    expect(body.linked).toEqual(['google']);
    expect(body.hasPin).toBe(true);
    // members/me-style exemption: your OWN address comes back, so Profile can
    // show which one you signed in with.
    expect(body.email).toBe('lin@example.com');
  });

  it("never reports another member's inventory", async () => {
    // The endpoint is cookie-keyed precisely so it cannot become a map of who
    // is easiest to attack. There is no name parameter to abuse, and a cookie
    // for one member must never surface another's.
    const me = seedMember('Lin', { pinHash: 'x' });
    const other = seedMember('Viktor', {
      email: 'viktor@example.com',
      passwordHash: 'scrypt$1$2$3$aa$bb',
    });
    await reserveIdentity('apple', 'sub-viktor', other.id);

    const body = await (await GET(req(`${METHODS}?name=Viktor`, asMember('Lin', me.id)))).json();
    expect(body.linked).toEqual([]);
    expect(body.email ?? null).toBeNull();
    expect(body.hasPassword).toBe(false);
  });

  it('nudges a PIN-only member and stops once a provider is linked', async () => {
    const pinOnly = seedMember('Kento', { pinHash: 'x' });
    const linked = seedMember('Akane', { pinHash: 'x' });
    await reserveIdentity('google', 'sub-akane', linked.id);

    const a = await (await GET(req(METHODS, asMember('Kento', pinOnly.id)))).json();
    const b = await (await GET(req(METHODS, asMember('Akane', linked.id)))).json();
    expect(a.nudge).toBe(true);
    expect(b.nudge).toBe(false);
  });

  it('never leaks a password hash', async () => {
    const m = seedMember('Sindhu', { pinHash: 'x', passwordHash: 'scrypt$1$2$3$aa$bb' });
    const text = JSON.stringify(await (await GET(req(METHODS, asMember('Sindhu', m.id)))).json());
    expect(text).not.toContain('scrypt$');
    expect(text).not.toContain('passwordHash');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    expect((await GET(req(METHODS))).status).toBe(404);
  });
});

describe('POST /api/auth/nudge', () => {
  it('refuses an anonymous caller', async () => {
    expect((await dismissNudge(req(NUDGE, undefined, 'POST'))).status).toBe(401);
  });

  it('records the dismissal on the member, not the device', async () => {
    // localStorage would re-nag the same person on every device they own.
    const m = seedMember('Carolina', { pinHash: 'x' });
    const res = await dismissNudge(req(NUDGE, asMember('Carolina', m.id), 'POST'));
    expect(res.status).toBe(200);

    const stored = (getStore()['members'] as Array<Record<string, unknown>>).find(
      (x) => x.id === m.id,
    )!;
    const nudge = stored.authNudge as { dismissedAt: string };
    expect(Date.parse(nudge.dismissedAt)).not.toBeNaN();
  });

  it('suppresses the nudge on the next read', async () => {
    const m = seedMember('Carolina', { pinHash: 'x' });
    const before = await (await GET(req(METHODS, asMember('Carolina', m.id)))).json();
    expect(before.nudge).toBe(true);

    await dismissNudge(req(NUDGE, asMember('Carolina', m.id), 'POST'));

    const after = await (await GET(req(METHODS, asMember('Carolina', m.id)))).json();
    expect(after.nudge).toBe(false);
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    expect((await dismissNudge(req(NUDGE, undefined, 'POST'))).status).toBe(404);
  });
});
