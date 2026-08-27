import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  classifyState,
  verifyState,
  describeCallbackContext,
  STATE_COOKIE,
} from '@/lib/oauthState';

/**
 * `state_mismatch` conflated two different bugs, and the iOS PWA investigation
 * stalled on exactly that: a missing cookie and a wrong cookie are the same
 * error string, but one is architectural (the callback came from a different
 * storage context) and the other is ordinary (stale cookie, raced flows).
 *
 * These pin the discriminator, and pin that the diagnostic never logs a secret.
 */

const S = 'a'.repeat(64);

describe('classifyState — which half of state_mismatch happened', () => {
  it('passes a matching pair', () => {
    expect(classifyState(S, S)).toBe('ok');
  });

  it('reports cookie_absent when the callback carried no state cookie', () => {
    expect(classifyState(null, S)).toBe('cookie_absent');
  });

  it('treats an empty-string cookie as absent, not as a mismatch', () => {
    expect(classifyState('', S)).toBe('cookie_absent');
  });

  /**
   * The precedence that matters. With both missing, "no cookie" is the signal
   * worth surfacing — it is what distinguishes the jar split — so it must win
   * over the equally-true "no param".
   */
  it('reports cookie_absent, not param_absent, when BOTH are missing', () => {
    expect(classifyState(null, null)).toBe('cookie_absent');
  });

  it('reports param_absent when we held a cookie but the provider sent nothing', () => {
    expect(classifyState(S, null)).toBe('param_absent');
  });

  it('reports differs for two different same-length values', () => {
    expect(classifyState(S, 'b'.repeat(64))).toBe('differs');
  });

  it('reports differs for a length mismatch rather than throwing', () => {
    expect(classifyState(S, 'b'.repeat(32))).toBe('differs');
  });

  it('verifyState stays a boolean view of the same decision', () => {
    expect(verifyState(S, S)).toBe(true);
    expect(verifyState(null, S)).toBe(false);
    expect(verifyState(S, 'b'.repeat(64))).toBe(false);
  });
});

function reqWith(cookie: string | null, headers: Record<string, string> = {}) {
  return new NextRequest('https://bpm.grantzou.com/bpm/api/auth/google/callback?code=x&state=y', {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
}

describe('describeCallbackContext — the log line', () => {
  /**
   * The whole point of the diagnostic. A cross-site callback carrying ZERO
   * cookies from our own origin is the jar split; carrying some but not the
   * state is an ordinary bug.
   */
  it('says NONE and count=0 when no cookies reached the callback', () => {
    const out = describeCallbackContext(reqWith(null, { 'sec-fetch-site': 'cross-site' }));
    expect(out).toContain('cookies=[NONE]');
    expect(out).toContain('count=0');
    expect(out).toContain('sec-fetch-site=cross-site');
  });

  it('lists cookie NAMES, sorted, when some arrived', () => {
    const out = describeCallbackContext(reqWith(`zeta=1; ${STATE_COOKIE}=${S}; alpha=2`));
    expect(out).toContain(`cookies=[alpha,${STATE_COOKIE},zeta]`);
    expect(out).toContain('count=3');
  });

  /** A state value in a log is a credential in a log. */
  it('NEVER leaks a cookie value', () => {
    const out = describeCallbackContext(reqWith(`${STATE_COOKIE}=${S}; member_session=super-secret`));
    expect(out).not.toContain(S);
    expect(out).not.toContain('super-secret');
    // ...while still proving the cookies were present.
    expect(out).toContain(STATE_COOKIE);
    expect(out).toContain('member_session');
  });

  it('renders a dash for headers the request did not carry', () => {
    const out = describeCallbackContext(reqWith(null));
    expect(out).toContain('sec-fetch-site=-');
    expect(out).toContain('ua=-');
  });

  it('truncates a long user-agent instead of dumping it', () => {
    const ua = 'Mozilla/5.0 ' + 'x'.repeat(400);
    const out = describeCallbackContext(reqWith(null, { 'user-agent': ua }));
    expect(out).toContain('Mozilla/5.0');
    expect(out.length).toBeLessThan(500);
    expect(out).not.toContain('x'.repeat(200));
  });
});
