import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  createState,
  createCodeVerifier,
  setOAuthCookies,
  readOAuthCookies,
  clearOAuthCookies,
  verifyState,
  STATE_COOKIE,
  VERIFIER_COOKIE,
} from '../lib/oauthState';

function header(res: NextResponse, name: string): string {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))!;
}

describe('createState / createCodeVerifier', () => {
  it('mints unguessable, distinct values', () => {
    expect(createState()).not.toBe(createState());
    expect(createState()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makes a code_verifier inside the RFC 7636 length window', () => {
    const v = createCodeVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/); // unreserved characters only
  });
});

describe('cookie SameSite by callback mode', () => {
  it('uses Lax for a redirect callback (Google)', () => {
    const res = NextResponse.json({});
    setOAuthCookies(res, 'redirect', { state: 'abc', codeVerifier: 'xyz' });
    expect(header(res, STATE_COOKIE)).toMatch(/SameSite=lax/i);
    expect(header(res, VERIFIER_COOKIE)).toMatch(/SameSite=lax/i);
  });

  it('uses None+Secure for a form_post callback (Apple)', () => {
    // A cross-site POST strips even Lax, so Apple's state cookie would never
    // come back and every attempt would die as a state mismatch. None is only
    // honoured with Secure -- which is also why Apple cannot be tested over
    // plain http://localhost.
    const res = NextResponse.json({});
    setOAuthCookies(res, 'form_post', { state: 'abc' });
    const h = header(res, STATE_COOKIE);
    expect(h).toMatch(/SameSite=none/i);
    expect(h).toMatch(/Secure/);
  });

  it('always sets HttpOnly and scopes to the basePath', () => {
    const res = NextResponse.json({});
    setOAuthCookies(res, 'redirect', { state: 'abc' });
    const h = header(res, STATE_COOKIE);
    expect(h).toMatch(/HttpOnly/i);
    expect(h).toMatch(/Path=\/bpm/);
  });
});

describe('readOAuthCookies / clearOAuthCookies', () => {
  it('reads back what was set', () => {
    const req = new NextRequest('http://localhost:3000/bpm/api/auth/google/callback', {
      headers: { cookie: `${STATE_COOKIE}=s1; ${VERIFIER_COOKIE}=v1` },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(readOAuthCookies(req)).toEqual({ state: 's1', codeVerifier: 'v1' });
  });

  it('reports nulls when nothing is present', () => {
    const req = new NextRequest('http://localhost:3000/bpm/api/auth/google/callback');
    expect(readOAuthCookies(req)).toEqual({ state: null, codeVerifier: null });
  });

  it('expires both on clear', () => {
    const res = NextResponse.json({});
    clearOAuthCookies(res);
    const headers = res.headers.getSetCookie();
    expect(headers.filter((h) => /Max-Age=0/.test(h))).toHaveLength(2);
  });
});

describe('verifyState', () => {
  it('accepts a matching pair', () => {
    const s = createState();
    expect(verifyState(s, s)).toBe(true);
  });

  it('rejects a mismatch, a missing half, and an empty pair', () => {
    const s = createState();
    expect(verifyState(s, createState())).toBe(false);
    expect(verifyState(null, s)).toBe(false);
    expect(verifyState(s, null)).toBe(false);
    expect(verifyState('', '')).toBe(false);
  });

  it('rejects a prefix rather than throwing on a length mismatch', () => {
    const s = createState();
    expect(verifyState(s, s.slice(0, 10))).toBe(false);
  });
});
