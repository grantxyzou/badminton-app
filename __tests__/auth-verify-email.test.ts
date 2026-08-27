import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, seedMember, getStore, makeRequest } from './helpers';
import { GET } from '../app/api/auth/verify-email/route';
import { reserveIdentity } from '../lib/authIdentity';
import { createToken, VERIFICATION_TTL_MS } from '../lib/authToken';

const BASE = 'http://localhost:3000/bpm/api/auth/verify-email';

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

async function seedUnverified(ttl = VERIFICATION_TTL_MS) {
  const { token, record } = createToken(ttl);
  const member = seedMember('Akane', {
    email: 'akane@example.com',
    emailVerified: false,
    emailVerification: record,
  });
  await reserveIdentity('email', 'akane@example.com', member.id);
  return { token, member };
}

function stored(id: string) {
  return getStore()['members'].find((m) => (m as { id: string }).id === id) as Record<
    string,
    unknown
  >;
}

function url(token: string, email = 'akane@example.com') {
  return `${BASE}?token=${token}&email=${encodeURIComponent(email)}`;
}

describe('GET /api/auth/verify-email', () => {
  it('verifies the address and consumes the token', async () => {
    const { token, member } = await seedUnverified();
    const res = await GET(makeRequest('GET', url(token)));
    // A redirect, not JSON: this URL is opened from a mail client, and a raw
    // JSON error page is a dead end for the person reading it.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('verified=1');

    const after = stored(member.id);
    expect(after.emailVerified).toBe(true);
    expect(after.emailVerification).toBeUndefined();
  });

  it('is idempotent on a re-tapped link, and the token stays consumed', async () => {
    // People re-tap links out of mailboxes. The token is genuinely single-use
    // -- the stored record is deleted on redemption, so it grants nothing the
    // second time -- but the account state is already terminal, so answering
    // "that failed" would be a worse lie than answering yes twice.
    const { token, member } = await seedUnverified();
    await GET(makeRequest('GET', url(token)));
    const again = await GET(makeRequest('GET', url(token)));
    expect(again.headers.get('location')).toContain('verified=1');
    expect(stored(member.id).emailVerification).toBeUndefined();
  });

  it('cannot verify an unverified member with an already-consumed token', async () => {
    // The single-use property that actually matters: if the member is NOT
    // verified, a token whose record is gone must not work. This is the state
    // an admin reset or a re-issued token would produce.
    const { token, member } = await seedUnverified();
    const row = stored(member.id);
    delete row.emailVerification;
    row.emailVerified = false;

    const res = await GET(makeRequest('GET', url(token)));
    expect(res.headers.get('location')).toContain('verified=0');
    expect(stored(member.id).emailVerified).toBe(false);
  });

  it('refuses an expired link', async () => {
    const { token, member } = await seedUnverified(-1000);
    const res = await GET(makeRequest('GET', url(token)));
    expect(res.headers.get('location')).toContain('verified=0');
    expect(stored(member.id).emailVerified).toBe(false);
  });

  it('refuses a token presented with the wrong address', async () => {
    const { token } = await seedUnverified();
    const res = await GET(makeRequest('GET', url(token, 'someone-else@example.com')));
    expect(res.headers.get('location')).toContain('verified=0');
  });

  it('refuses a garbage token', async () => {
    await seedUnverified();
    const res = await GET(makeRequest('GET', url('not-a-real-token')));
    expect(res.headers.get('location')).toContain('verified=0');
  });
});
