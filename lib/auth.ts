/**
 * Admin auth — unified per-player model.
 *
 * Background: until PR B, admin auth used a shared `ADMIN_PIN` env var hashed
 * to a static cookie value. Anyone who knew the PIN got admin powers; the
 * cookie carried no identity, just proof-of-pin.
 *
 * After PR B, admin auth is per-player. The cookie carries a signed payload
 * `{ memberId, name, iat, exp }` HMAC'd with `SESSION_SECRET`. The Member
 * record's `role: 'admin'` is the source of truth for authorization; the
 * cookie only proves identity. Revocation is by demoting the Member; the
 * next admin request fails the role re-check.
 *
 * Two verification surfaces:
 *
 * - `isAdminAuthed(req): boolean` — sync. Verifies signature + expiry only.
 *   Cheap; no Cosmos round-trip. Used by read-only routes where a stale role
 *   bit matters less.
 * - `isAdminAuthedWithMember(req): Promise<...>` — async. Adds a Member
 *   re-fetch so the role bit is fresh. Used by routes that mutate data.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import type { Member } from '@/lib/types';

const COOKIE_NAME = 'admin_session';
// 30 days — matches the longevity users expect from their `badminton_identity`
// localStorage entry. The original 8h TTL was too conservative for a friend-
// group admin role, causing "I'm signed in as Grant but Admin asks for PIN
// again" friction. Re-PIN on Profile logout or natural 30d expiry.
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

/**
 * Returns the HMAC secret. In production, the env var must be set or we
 * throw at module-load (callers can't recover from a missing secret in any
 * meaningful way). In dev, fall back to a hard-coded sentinel and log a
 * warning so local-only flows still work.
 */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET environment variable is missing or too short (>=32 chars). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[dev] SESSION_SECRET not set; falling back to a dev sentinel. ' +
      'Sessions signed with this secret are NOT secure for production use.',
  );
  return 'dev-fallback-secret-not-for-production-use-please';
}

interface SessionPayload {
  memberId: string;
  name: string;
  iat: number; // seconds
  exp: number; // seconds
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function signPayload(payload: SessionPayload): string {
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', getSessionSecret()).update(headerB64).digest();
  const sigB64 = base64urlEncode(sig);
  return `${headerB64}.${sigB64}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [headerB64, sigB64] = parts;
  const expectedSig = createHmac('sha256', getSessionSecret()).update(headerB64).digest();
  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(headerB64).toString('utf8')) as SessionPayload;
    if (
      typeof payload.memberId !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Sets the admin session cookie. The cookie value is a signed payload that
 * binds the session to a specific Member (by id + name). 8h lifetime.
 */
export function setAdminCookie(res: NextResponse, memberId: string, name: string): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    memberId,
    name,
    iat: now,
    exp: now + COOKIE_MAX_AGE_S,
  };
  res.cookies.set(COOKIE_NAME, signPayload(payload), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_S,
    path: '/',
  });
}

export function clearAdminCookie(res: NextResponse): void {
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
    path: '/',
  });
}

/**
 * Sync admin check — verifies the cookie's signature and expiry only. Does
 * NOT re-check the Member's role. Cheaper, used by read-only routes.
 */
export function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return false;
  return verifyToken(cookie) !== null;
}

/**
 * Async admin check — verifies the cookie AND re-fetches the Member to
 * confirm `role === 'admin' && active === true`. Use in routes that mutate
 * data; protects against role demotion taking effect immediately on the next
 * request rather than on next cookie expiry.
 */
export async function isAdminAuthedWithMember(
  req: NextRequest,
): Promise<{ authed: true; memberId: string; name: string } | { authed: false }> {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return { authed: false };
  const payload = verifyToken(cookie);
  if (!payload) return { authed: false };

  try {
    const container = getContainer('members');
    const { resource } = await container.item(payload.memberId, payload.memberId).read<Member>();
    if (!resource || resource.active !== true || resource.role !== 'admin') {
      return { authed: false };
    }
    return { authed: true, memberId: resource.id, name: resource.name };
  } catch {
    return { authed: false };
  }
}

/**
 * Returns the comma-separated `ADMIN_NAMES` list as a normalized lowercase
 * Set. Used to seed the first admin(s) so a newly-deployed instance has a
 * way in without needing direct Cosmos access.
 */
export function getAdminNames(): Set<string> {
  const raw = process.env.ADMIN_NAMES ?? '';
  const names = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  return new Set(names);
}

export function isNameInAdminBootstrap(name: string): boolean {
  return getAdminNames().has(name.trim().toLowerCase());
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
