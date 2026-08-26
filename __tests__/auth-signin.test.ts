import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, seedMember, makeRequest } from './helpers';
import { POST } from '../app/api/auth/signin/route';
import { reserveIdentity } from '../lib/authIdentity';
import { hashPassword } from '../lib/passwordHash';

const URL_ = 'http://localhost:3000/bpm/api/auth/signin';

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

async function seedAccount(
  name: string,
  email: string,
  password: string,
  over: Record<string, unknown> = {},
) {
  const member = seedMember(name, {
    email,
    emailVerified: true,
    passwordHash: await hashPassword(password),
    ...over,
  });
  await reserveIdentity('email', email, member.id);
  return member;
}

function cookies(res: Response) {
  return res.headers.getSetCookie().join('\n');
}

describe('POST /api/auth/signin', () => {
  it('signs in with the right password', async () => {
    await seedAccount('Kento', 'kento@example.com', 'a good long password');
    const res = await POST(
      makeRequest('POST', URL_, { email: 'KENTO@example.com', password: 'a good long password' }),
    );
    expect(res.status).toBe(200);
    expect(cookies(res)).toMatch(/member_session=[^;]+;/);
  });

  it('gives an identical answer for a wrong password and an unknown address', async () => {
    // Otherwise the response is an account-enumeration oracle: an attacker
    // learns which of your friends have accounts by watching the difference.
    await seedAccount('Kento', 'kento@example.com', 'a good long password');
    const wrong = await POST(
      makeRequest('POST', URL_, { email: 'kento@example.com', password: 'not the password' }),
    );
    const unknown = await POST(
      makeRequest('POST', URL_, { email: 'nobody@example.com', password: 'not the password' }),
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it('refuses an account with no password set', async () => {
    // A PIN-only member who has never added a password must not be signable-in
    // by sending an empty or arbitrary password.
    const m = seedMember('Sindhu', { email: 'sindhu@example.com', pinHash: 'x' });
    await reserveIdentity('email', 'sindhu@example.com', m.id);
    const res = await POST(
      makeRequest('POST', URL_, { email: 'sindhu@example.com', password: 'anything at all' }),
    );
    expect(res.status).toBe(401);
  });

  it('refuses a deactivated member', async () => {
    await seedAccount('Akane', 'akane@example.com', 'a good long password', { active: false });
    const res = await POST(
      makeRequest('POST', URL_, { email: 'akane@example.com', password: 'a good long password' }),
    );
    expect(res.status).toBe(401);
  });

  it('issues an admin cookie for an admin', async () => {
    await seedAccount('Grant', 'grant@example.com', 'a good long password', { role: 'admin' });
    const res = await POST(
      makeRequest('POST', URL_, { email: 'grant@example.com', password: 'a good long password' }),
    );
    expect(cookies(res)).toMatch(/admin_session=[^;]+;/);
  });

  it('clears a stale admin cookie when a non-admin signs in', async () => {
    await seedAccount('Viktor', 'viktor@example.com', 'a good long password');
    const res = await POST(
      makeRequest('POST', URL_, { email: 'viktor@example.com', password: 'a good long password' }),
    );
    expect(cookies(res)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });

  it('never leaks a secret in the response', async () => {
    await seedAccount('Kento', 'kento@example.com', 'a good long password');
    const res = await POST(
      makeRequest('POST', URL_, { email: 'kento@example.com', password: 'a good long password' }),
    );
    const text = JSON.stringify(await res.json());
    for (const s of ['passwordHash', 'pinHash', 'emailVerification', 'passwordReset']) {
      expect(text).not.toContain(s);
    }
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await POST(
      makeRequest('POST', URL_, { email: 'kento@example.com', password: 'a good long password' }),
    );
    expect(res.status).toBe(404);
  });
});
