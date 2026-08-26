import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, seedMember, getStore, setupAdminPin } from './helpers';
import { POST as forgot } from '../app/api/auth/forgot-password/route';
import { POST as signup } from '../app/api/auth/signup/route';
import { reserveIdentity } from '../lib/authIdentity';
import { requireOutboundOrigin, outboundOriginOrNull } from '../lib/appOrigin';
import * as authEmail from '../lib/authEmail';

/**
 * Host-header injection on the outbound links.
 *
 * `req.url` follows the client-controlled `Host` / `X-Forwarded-Host` header.
 * Building an emailed link from it is an account takeover for the reset mail:
 *
 *   1. attacker POSTs /forgot-password with the victim's address and
 *      `Host: evil.example`
 *   2. the victim gets a GENUINE BPM email whose link points at evil.example
 *   3. the victim taps it, and the attacker now holds a live reset token
 *
 * Nothing looks wrong to the victim at any step, which is why this fails
 * closed rather than degrading.
 */
const FORGOT = 'http://localhost:3000/bpm/api/auth/forgot-password';
const SIGNUP = 'http://localhost:3000/bpm/api/auth/signup';
const EVIL = 'evil.example';

let ipSeq = 0;
const savedOrigin = process.env.APP_ORIGIN;

beforeEach(() => {
  resetMockStore();
  // These cases stub NODE_ENV=production, under which getSessionSecret() fails
  // closed on a missing SESSION_SECRET -- correct behaviour, but it would mask
  // what this file is actually testing behind a 503.
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  // The credentials ARE configured in production, so the send path is live.
  process.env.GMAIL_USER = 'bpm@example.com';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  if (savedOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = savedOrigin;
  vi.restoreAllMocks();
});

/** A request whose URL carries an attacker-chosen host. */
function spoofed(url: string, body: Record<string, unknown>): NextRequest {
  const evilUrl = url.replace('localhost:3000', EVIL);
  return new NextRequest(evilUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: EVIL,
      'X-Forwarded-Host': EVIL,
      'X-Client-IP': `10.11.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
    },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe('outbound origin helper', () => {
  it('prefers APP_ORIGIN and strips a trailing slash', () => {
    process.env.APP_ORIGIN = 'https://bpm.grantzou.com/';
    expect(requireOutboundOrigin()).toBe('https://bpm.grantzou.com');
  });

  it('throws outside local envs when APP_ORIGIN is unset', () => {
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => requireOutboundOrigin()).toThrow(/APP_ORIGIN/);
    expect(outboundOriginOrNull()).toBeNull();
    vi.unstubAllEnvs();
  });

  it('falls back ONLY for development and test, never for an unset NODE_ENV', () => {
    // Mirrors getSessionSecret(): an internet-facing host booted with an
    // unexpected NODE_ENV must not silently take the insecure branch.
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'development');
    expect(requireOutboundOrigin()).toBe('http://localhost:3000');
    vi.stubEnv('NODE_ENV', 'staging');
    expect(outboundOriginOrNull()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('password reset link cannot be pointed at an attacker host', () => {
  it('uses APP_ORIGIN even when the request claims another host', async () => {
    process.env.APP_ORIGIN = 'https://bpm.grantzou.com';
    const spy = vi.spyOn(authEmail, 'sendPasswordResetEmail').mockResolvedValue({ sent: true });

    const m = seedMember('Victim', { email: 'victim@example.com', emailVerified: true });
    await reserveIdentity('email', 'victim@example.com', m.id);

    const res = await forgot(spoofed(FORGOT, { email: 'victim@example.com' }));
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalled();
    const mailedUrl = String(spy.mock.calls[0][2]);
    expect(mailedUrl.startsWith('https://bpm.grantzou.com/')).toBe(true);
    expect(mailedUrl).not.toContain(EVIL);
  });

  it('refuses to mail anything at all when APP_ORIGIN is unset in production', async () => {
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'production');
    const spy = vi.spyOn(authEmail, 'sendPasswordResetEmail').mockResolvedValue({ sent: true });

    const m = seedMember('Victim', { email: 'victim@example.com', emailVerified: true });
    await reserveIdentity('email', 'victim@example.com', m.id);

    const res = await forgot(spoofed(FORGOT, { email: 'victim@example.com' }));
    // Still 200 -- the enumeration-proof contract holds even while failing closed.
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();

    // And no token was minted, so nothing is left dangling on the record.
    const stored = (getStore()['members'] as Array<Record<string, unknown>>).find(
      (x) => x.id === m.id,
    )!;
    expect(stored.passwordReset).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe('verification link cannot be pointed at an attacker host', () => {
  it('uses APP_ORIGIN even when the request claims another host', async () => {
    process.env.APP_ORIGIN = 'https://bpm.grantzou.com';
    const spy = vi.spyOn(authEmail, 'sendVerificationEmail').mockResolvedValue({ sent: true });

    const res = await signup(
      spoofed(SIGNUP, {
        name: 'Newcomer',
        email: 'newcomer@example.com',
        password: 'a good long password',
      }),
    );
    expect(res.status).toBe(201);

    const mailedUrl = String(spy.mock.calls[0][2]);
    expect(mailedUrl.startsWith('https://bpm.grantzou.com/')).toBe(true);
    expect(mailedUrl).not.toContain(EVIL);
  });

  it('creates the account but skips the mail when APP_ORIGIN is unset in production', async () => {
    delete process.env.APP_ORIGIN;
    vi.stubEnv('NODE_ENV', 'production');
    const spy = vi.spyOn(authEmail, 'sendVerificationEmail').mockResolvedValue({ sent: true });

    const res = await signup(
      spoofed(SIGNUP, {
        name: 'Newcomer',
        email: 'newcomer@example.com',
        password: 'a good long password',
      }),
    );
    // The account is real and usable; only the poisoned link is withheld, and
    // the response says so, so the UI can offer a resend.
    expect(res.status).toBe(201);
    expect((await res.json()).verificationSent).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
