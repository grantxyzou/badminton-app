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
    // JSON error page is a dead end for the person reading it. 303 rather than
    // Next's default 307, so a redirect can never preserve a request method.
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('verified=1');

    const after = stored(member.id);
    expect(after.emailVerified).toBe(true);
    expect(after.emailVerification).toBeUndefined();
  });

  it('does NOT report success for a re-tapped, consumed link', async () => {
    // This used to answer verified=1 without checking the token, so that
    // re-tapping stayed idempotent. That made the endpoint an enumeration
    // oracle: probe `?token=anything&email=<addr>` and verified=1 confirmed a
    // verified account exists at that address -- precisely what an attacker
    // wants before trying a reset.
    //
    // The idempotency is recovered in COPY instead: the verified=0 landing says
    // the link is used or expired and that an already-confirmed address needs
    // nothing further. True either way, and it reveals nothing.
    const { token, member } = await seedUnverified();
    await GET(makeRequest('GET', url(token)));
    const again = await GET(makeRequest('GET', url(token)));
    expect(again.headers.get('location')).toContain('verified=0');
    // The address stays verified — only the ANSWER is uninformative.
    expect(stored(member.id).emailVerified).toBe(true);
    expect(stored(member.id).emailVerification).toBeUndefined();
  });

  it('gives an unverified-account probe the same answer as a wrong token', async () => {
    // The oracle test: an attacker guessing at addresses must not be able to
    // tell a real verified account from anything else.
    const { member } = await seedUnverified();
    const row = stored(member.id);
    row.emailVerified = true;
    delete row.emailVerification;

    const probeReal = await GET(makeRequest('GET', url('deadbeef')));
    const probeUnknown = await GET(
      makeRequest('GET', url('deadbeef', 'nobody-at-all@example.com')),
    );
    expect(probeReal.headers.get('location')).toContain('verified=0');
    expect(probeUnknown.headers.get('location')).toContain('verified=0');
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
