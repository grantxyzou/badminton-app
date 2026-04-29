import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  setAdminCookie,
  isAdminAuthed,
  isAdminAuthedWithMember,
  clearAdminCookie,
  getAdminNames,
  isNameInAdminBootstrap,
} from '../lib/auth';
import { resetMockStore, seedTestAdminMember } from './helpers';

const SECRET = 'test-session-secret-not-for-production-use-please';

function buildReqWithCookie(value: string): NextRequest {
  const headers: Record<string, string> = { Cookie: `admin_session=${value}` };
  return new NextRequest('http://localhost:3000/api/admin', { method: 'GET', headers } as never);
}

function buildBareReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin', { method: 'GET' } as never);
}

function extractCookieValue(res: NextResponse): string {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_session=([^;]+)/);
  if (!match) throw new Error('admin_session not in Set-Cookie header');
  return match[1];
}

describe('lib/auth — signed-payload cookie', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it('round-trips a valid cookie through setAdminCookie + isAdminAuthed', () => {
    const res = NextResponse.json({});
    setAdminCookie(res, 'member-grant', 'Grant');
    const cookieValue = extractCookieValue(res);
    const req = buildReqWithCookie(cookieValue);
    expect(isAdminAuthed(req)).toBe(true);
  });

  it('isAdminAuthed returns false when cookie is missing', () => {
    expect(isAdminAuthed(buildBareReq())).toBe(false);
  });

  it('isAdminAuthed returns false when signature is invalid', () => {
    const res = NextResponse.json({});
    setAdminCookie(res, 'member-grant', 'Grant');
    const cookieValue = extractCookieValue(res);
    // Tamper with the signature segment
    const [header] = cookieValue.split('.');
    const tampered = `${header}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect(isAdminAuthed(buildReqWithCookie(tampered))).toBe(false);
  });

  it('isAdminAuthed returns false when payload is malformed', () => {
    expect(isAdminAuthed(buildReqWithCookie('not-a-valid-token'))).toBe(false);
    expect(isAdminAuthed(buildReqWithCookie('one-segment-only'))).toBe(false);
  });

  it('isAdminAuthed returns false when token is expired', () => {
    // Build a token with exp in the past, signed with the same secret
    const { createHmac } = require('crypto');
    const past = Math.floor(Date.now() / 1000) - 100;
    const payload = { memberId: 'm', name: 'n', iat: past - 60, exp: past };
    const headerB64 = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const sig = createHmac('sha256', SECRET).update(headerB64).digest();
    const sigB64 = sig.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${headerB64}.${sigB64}`;
    expect(isAdminAuthed(buildReqWithCookie(token))).toBe(false);
  });

  it('clearAdminCookie sets the cookie to empty with maxAge 0', () => {
    const res = NextResponse.json({});
    clearAdminCookie(res);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('admin_session=');
    expect(setCookie.toLowerCase()).toMatch(/max-age=0/);
  });
});

describe('lib/auth — async role re-check', () => {
  beforeEach(async () => {
    process.env.SESSION_SECRET = SECRET;
    resetMockStore();
    await seedTestAdminMember();
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it('isAdminAuthedWithMember returns authed:true when Member exists with role=admin', async () => {
    const res = NextResponse.json({});
    setAdminCookie(res, 'member-test-admin', 'Test Admin');
    const cookieValue = extractCookieValue(res);
    const result = await isAdminAuthedWithMember(buildReqWithCookie(cookieValue));
    expect(result.authed).toBe(true);
    if (result.authed) {
      expect(result.memberId).toBe('member-test-admin');
      expect(result.name).toBe('Test Admin');
    }
  });

  it('isAdminAuthedWithMember returns authed:false when Member is demoted', async () => {
    const res = NextResponse.json({});
    setAdminCookie(res, 'member-test-admin', 'Test Admin');
    const cookieValue = extractCookieValue(res);
    // Demote the seeded admin
    const { getStore } = await import('./helpers');
    const store = getStore();
    const members = store['members'] as Array<{ id: string; role: string }>;
    const admin = members.find((m) => m.id === 'member-test-admin');
    if (admin) admin.role = 'member';
    const result = await isAdminAuthedWithMember(buildReqWithCookie(cookieValue));
    expect(result.authed).toBe(false);
  });

  it('isAdminAuthedWithMember returns authed:false when Member is missing', async () => {
    const res = NextResponse.json({});
    setAdminCookie(res, 'member-does-not-exist', 'Ghost');
    const cookieValue = extractCookieValue(res);
    const result = await isAdminAuthedWithMember(buildReqWithCookie(cookieValue));
    expect(result.authed).toBe(false);
  });
});

describe('lib/auth — ADMIN_NAMES bootstrap helpers', () => {
  afterEach(() => {
    delete process.env.ADMIN_NAMES;
  });

  it('parses comma-separated names into a normalized lowercase Set', () => {
    process.env.ADMIN_NAMES = 'Grant, Mei , david-park';
    const names = getAdminNames();
    expect(names.has('grant')).toBe(true);
    expect(names.has('mei')).toBe(true);
    expect(names.has('david-park')).toBe(true);
    expect(names.size).toBe(3);
  });

  it('isNameInAdminBootstrap is case-insensitive + trims', () => {
    process.env.ADMIN_NAMES = 'Grant';
    expect(isNameInAdminBootstrap('grant')).toBe(true);
    expect(isNameInAdminBootstrap('  GRANT  ')).toBe(true);
    expect(isNameInAdminBootstrap('Grant Walter')).toBe(false);
  });

  it('returns empty set when ADMIN_NAMES is unset or empty', () => {
    delete process.env.ADMIN_NAMES;
    expect(getAdminNames().size).toBe(0);
    process.env.ADMIN_NAMES = '';
    expect(getAdminNames().size).toBe(0);
    process.env.ADMIN_NAMES = ',  ,';
    expect(getAdminNames().size).toBe(0);
  });
});
