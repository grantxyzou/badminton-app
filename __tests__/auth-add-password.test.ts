import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, seedMember, setupAdminPin, memberCookieValue, getStore } from './helpers';
import { POST } from '../app/api/auth/password/route';
import { lookupIdentity, reserveIdentity } from '../lib/authIdentity';
import { verifyPassword } from '../lib/passwordHash';

/**
 * POST /api/auth/password — "Keep your account" with an email and password
 * (docs/plans/door-link.md; Grant, 2026-11-07). A person an organiser let in
 * has a session and nothing to sign in with; this puts a password on THEIR
 * OWN account, never anyone else's.
 */
const URL_ = 'http://localhost:3000/bpm/api/auth/password';
const GOOD = 'shuttle-court-42';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
});

function req(body: unknown, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-IP': `10.41.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(URL_, { method: 'POST', headers, body: JSON.stringify(body) } as any);
}
const asMember = (name: string, id: string) => `member_session=${memberCookieValue(name, id)}`;
const stored = (id: string) => (getStore()['members'] as Array<Record<string, unknown>>).find((m) => m.id === id)!;

describe('POST /api/auth/password', () => {
  it('adds an email and password to the signed-in member, unverified', async () => {
    const m = seedMember('Sandra Lee');
    const res = await POST(req({ email: ' Sandra@Example.com ', password: GOOD }, asMember('Sandra Lee', m.id)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: 'sandra@example.com' });
    const doc = stored(m.id);
    expect(doc.email).toBe('sandra@example.com');
    expect(doc.emailVerified).toBe(false);
    expect(await verifyPassword(GOOD, doc.passwordHash as string)).toBe(true);
    expect((await lookupIdentity('email', 'sandra@example.com'))?.memberId).toBe(m.id);
  });

  it('refuses without a member cookie, and never takes a name or id from the body', async () => {
    const m = seedMember('Sandra Lee');
    const res = await POST(req({ email: 's@example.com', password: GOOD, memberId: m.id, name: 'Sandra Lee' }));
    expect(res.status).toBe(401);
    expect(stored(m.id).passwordHash).toBeUndefined();
  });

  it('refuses an address that belongs to someone else', async () => {
    const other = seedMember('Lin Dan');
    await reserveIdentity('email', 'lin@example.com', other.id);
    const m = seedMember('Sandra Lee');
    const res = await POST(req({ email: 'lin@example.com', password: GOOD }, asMember('Sandra Lee', m.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('email_taken');
    expect(stored(m.id).passwordHash).toBeUndefined();
  });

  it('refuses a second password: changing one is the reset flow', async () => {
    const m = seedMember('Sandra Lee', { passwordHash: 'scrypt$existing', email: 'sandra@example.com' });
    const res = await POST(req({ email: 'new@example.com', password: GOOD }, asMember('Sandra Lee', m.id)));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('password_exists');
    expect(await lookupIdentity('email', 'new@example.com')).toBeNull();
  });

  it('refuses a weak password and a malformed address before touching anything', async () => {
    const m = seedMember('Sandra Lee');
    const weak = await POST(req({ email: 's@example.com', password: 'short' }, asMember('Sandra Lee', m.id)));
    expect(weak.status).toBe(400);
    expect((await weak.json()).error).toBe('weak_password');
    const bad = await POST(req({ email: 'not-an-email', password: GOOD }, asMember('Sandra Lee', m.id)));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_email');
    expect(await lookupIdentity('email', 's@example.com')).toBeNull();
  });

  it('refuses a removed member whose cookie has not lapsed', async () => {
    const m = seedMember('Sandra Lee', { active: false });
    const res = await POST(req({ email: 's@example.com', password: GOOD }, asMember('Sandra Lee', m.id)));
    expect(res.status).toBe(401);
  });
});
