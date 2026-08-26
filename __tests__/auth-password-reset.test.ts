import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, seedMember, getStore, makeRequest } from './helpers';
import { POST as forgot } from '../app/api/auth/forgot-password/route';
import { POST as reset } from '../app/api/auth/reset-password/route';
import { reserveIdentity } from '../lib/authIdentity';
import { hashPassword, verifyPassword } from '../lib/passwordHash';
import { createToken, RESET_TTL_MS } from '../lib/authToken';

const FORGOT = 'http://localhost:3000/bpm/api/auth/forgot-password';
const RESET = 'http://localhost:3000/bpm/api/auth/reset-password';

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

// Derived once per file: scrypt at N=2^16 costs 64 MiB a time, and the suite
// runs files in parallel workers.
const originalHash = hashPassword('the original password');

async function seedAccount(over: Record<string, unknown> = {}) {
  const member = seedMember('Sindhu', {
    email: 'sindhu@example.com',
    emailVerified: true,
    passwordHash: await originalHash,
    ...over,
  });
  await reserveIdentity('email', 'sindhu@example.com', member.id);
  return member;
}

function stored(id: string) {
  return getStore()['members'].find((m) => (m as { id: string }).id === id) as Record<
    string,
    unknown
  >;
}

describe('POST /api/auth/forgot-password', () => {
  it('answers 200 for an unknown address and writes nothing', async () => {
    // Any other answer is an account-enumeration oracle: an attacker learns
    // which of your friends have accounts by watching the difference.
    const res = await forgot(makeRequest('POST', FORGOT, { email: 'nobody@example.com' }));
    expect(res.status).toBe(200);
    expect(getStore()['members'] ?? []).toEqual([]);
  });

  it('answers 200 for a known address and stores a reset record', async () => {
    const member = await seedAccount();
    const res = await forgot(makeRequest('POST', FORGOT, { email: 'SINDHU@example.com' }));
    expect(res.status).toBe(200);
    const rec = stored(member.id).passwordReset as { hash: string; expiresAt: number };
    expect(rec).toBeTruthy();
    expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same body either way', async () => {
    await seedAccount();
    const known = await forgot(makeRequest('POST', FORGOT, { email: 'sindhu@example.com' }));
    const unknown = await forgot(makeRequest('POST', FORGOT, { email: 'nobody@example.com' }));
    expect(await known.json()).toEqual(await unknown.json());
  });
});

describe('POST /api/auth/reset-password', () => {
  async function seedWithResetToken(ttl = RESET_TTL_MS) {
    const { token, record } = createToken(ttl);
    const member = await seedAccount({ passwordReset: record });
    return { token, member };
  }

  it('sets the new password, retires the old one, and signs the user in', async () => {
    const { token, member } = await seedWithResetToken();
    const res = await reset(
      makeRequest('POST', RESET, {
        email: 'sindhu@example.com',
        token,
        password: 'a brand new password',
      }),
    );
    expect(res.status).toBe(200);
    // Proving control of the mailbox is a sign-in, so don't make them do it twice.
    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);

    const after = stored(member.id);
    expect(await verifyPassword('a brand new password', after.passwordHash as string)).toBe(true);
    expect(await verifyPassword('the original password', after.passwordHash as string)).toBe(false);
    expect(after.passwordReset).toBeUndefined();
  });

  it('refuses to reuse a consumed token', async () => {
    const { token } = await seedWithResetToken();
    await reset(
      makeRequest('POST', RESET, { email: 'sindhu@example.com', token, password: 'first new one' }),
    );
    const again = await reset(
      makeRequest('POST', RESET, { email: 'sindhu@example.com', token, password: 'second new one' }),
    );
    expect(again.status).toBe(400);
  });

  it('refuses an expired token and leaves the password alone', async () => {
    const { token, member } = await seedWithResetToken(-1000);
    const res = await reset(
      makeRequest('POST', RESET, { email: 'sindhu@example.com', token, password: 'a new password' }),
    );
    expect(res.status).toBe(400);
    expect(await verifyPassword('the original password', stored(member.id).passwordHash as string)).toBe(
      true,
    );
  });

  it('refuses a weak new password without consuming the token', async () => {
    const { token, member } = await seedWithResetToken();
    const res = await reset(
      makeRequest('POST', RESET, { email: 'sindhu@example.com', token, password: 'short' }),
    );
    expect(res.status).toBe(400);
    // The token must survive, or a typo would cost the user their only link.
    expect(stored(member.id).passwordReset).toBeTruthy();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await reset(
      makeRequest('POST', RESET, { email: 'x@example.com', token: 'a', password: 'a long password' }),
    );
    expect(res.status).toBe(404);
  });
});
