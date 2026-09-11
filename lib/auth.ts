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
import { isFlagOn } from '@/lib/flags';
import { BPM_GROUP_ID } from '@/lib/groupScope';
import { readMembership, readGroupAdmin } from '@/lib/groups';
import type { Member, MembershipRole } from '@/lib/types';
/** Server-read: while off, every claim reads as BPM and memberships are not consulted. */
const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

const COOKIE_NAME = 'admin_session';
// 30 days — matches the longevity users expect from their `badminton_identity`
// localStorage entry. The original 8h TTL was too conservative for a friend-
// group admin role, causing "I'm signed in as Grant but Admin asks for PIN
// again" friction. Re-PIN on Profile logout or natural 30d expiry.
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

// Cookies are scoped to the app's basePath (`/bpm`, see next.config.js) rather
// than the origin root, matching the `NEXT_LOCALE` cookie. `LEGACY_COOKIE_PATH`
// is the root path our cookies used before this migration — we must keep
// clearing it so anyone still holding a root-scoped cookie can actually sign
// out (a `/bpm` clear does NOT delete a `/`-scoped cookie of the same name).
const COOKIE_PATH = '/bpm';
const LEGACY_COOKIE_PATH = '/';

/**
 * Append a same-name cookie-clearing `Set-Cookie` header for both the current
 * and legacy paths.
 *
 * Why append-only (never `res.cookies.set`): Next's `ResponseCookies` keeps an
 * internal map keyed by cookie NAME alone, so it cannot represent the same
 * cookie at two paths, and every `.set()` re-serializes the whole map —
 * silently dropping any header we appended earlier. The logout route clears two
 * cookies on one response, so a `.set()`-based clear of the second would wipe
 * the first's legacy-path header. Building the headers by hand sidesteps that.
 * (Verified empirically before writing this.) Do NOT call a `set*Cookie` helper
 * AFTER a `clear*Cookie` on the same response — the re-serialization would drop
 * these appended headers.
 */
function appendClearCookie(res: NextResponse, name: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  for (const path of [COOKIE_PATH, LEGACY_COOKIE_PATH]) {
    res.headers.append(
      'set-cookie',
      `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
    );
  }
}

/**
 * Returns the HMAC secret. A real `SESSION_SECRET` (>=32 chars) is always
 * preferred. The hard-coded dev sentinel is only used for *explicitly* local
 * environments (`NODE_ENV` of `development` or `test`).
 *
 * Security: previously the fallback fired for any `NODE_ENV !== 'production'`,
 * which meant an internet-facing host booted with an unset/unexpected
 * `NODE_ENV` (e.g. a misconfigured preview running a bare `next` server) would
 * sign admin cookies with a *public constant from this repo* — anyone could
 * forge a valid `admin_session`. We now fail closed: only the two known-local
 * envs get the sentinel; everything else throws.
 */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') {
    console.warn(
      '[dev] SESSION_SECRET not set; falling back to a dev sentinel. ' +
        'Sessions signed with this secret are NOT secure for production use.',
    );
    return 'dev-fallback-secret-not-for-production-use-please';
  }
  throw new Error(
    `SESSION_SECRET environment variable is missing or too short (>=32 chars); ` +
      `refusing to sign sessions with the public dev sentinel (NODE_ENV=${env ?? 'unset'}). ` +
      'Generate with: openssl rand -hex 32',
  );
}

/**
 * WHICH CREDENTIAL A TOKEN IS.
 *
 * One `SESSION_SECRET` signs both session cookies over the identical
 * `{memberId, name, groupId, iat, exp}` shape, so before this field the only
 * thing separating a member session from an admin one was the cookie NAME the
 * client chose to put the value in — and the client chooses that. Any signed-in
 * member could copy their own `member_session` value, send it back as
 * `admin_session`, and pass every sync admin check. `typ` binds a token to its
 * purpose INSIDE the signature, so the two are no longer interchangeable.
 */
type SessionKind = 'admin' | 'member';

interface SessionPayload {
  memberId: string;
  name: string;
  /**
   * The group this session was minted FOR (multi-group Phase 2). Verified at
   * mint time against a membership, so the sync checks can keep trusting the
   * signature alone. Absent on a cookie minted before the claim existed —
   * which reads as BPM, the only group there was.
   */
  groupId?: string;
  /**
   * The audience. Additive and optional, like `groupId`: absent on a token
   * minted before this field existed, and ignored outright by older code on a
   * rollback. An absent `typ` reads as `'member'` — which leaves every live
   * `member_session` working (30-day TTL, deliberately matched to the client's
   * stored identity) and fails CLOSED for admin: a pre-deploy `admin_session`
   * no longer passes, and that admin re-PINs once.
   */
  typ?: SessionKind;
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

/**
 * Verifies signature, shape, AUDIENCE and (unless waived) expiry.
 *
 * `expect` is positional and required — a default is how a future caller
 * silently gets the wrong audience. `'either'` verifies a token's identity
 * without asking which credential carried it; `readGroupClaim` is its only
 * caller and says why there.
 */
function verifyToken(
  token: string,
  expect: SessionKind | 'either',
  opts: { ignoreExpiry?: boolean } = {},
): SessionPayload | null {
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
      typeof payload.exp !== 'number' ||
      (payload.groupId !== undefined && typeof payload.groupId !== 'string')
    ) {
      return null;
    }
    // The audience check, written as strict equality AT the comparison rather
    // than through a normalizing helper, so the one place legacy tolerance is
    // granted is visible: an admin token must SAY `'admin'`, while a member one
    // may also carry no `typ` at all (a cookie minted before the field existed).
    // Any other value is neither.
    if (expect === 'admin' && payload.typ !== 'admin') return null;
    if (expect === 'member' && payload.typ !== 'member' && payload.typ !== undefined) return null;
    if (!opts.ignoreExpiry && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generic signed-value helpers, sharing the session HMAC secret.
 *
 * Exists for short-lived server-issued payloads that are NOT sessions — the
 * `pending_signup` cookie that carries an unclaimed provider identity across
 * the "choose a display name" round trip. That payload asserts "Google told us
 * this sub owns this verified address", so it MUST be unforgeable: without a
 * signature the client could post any provider identity it liked and claim
 * someone else's linked account.
 *
 * Kept here rather than in a new module so there is exactly one place that
 * knows how this app signs things, and one `SESSION_SECRET` fail-closed check.
 */
export function signValue<T extends object>(value: T, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const envelope = JSON.stringify({ v: value, iat: now, exp: now + ttlSeconds });
  const b64 = base64urlEncode(Buffer.from(envelope, 'utf8'));
  const sig = createHmac('sha256', getSessionSecret()).update(b64).digest();
  return `${b64}.${base64urlEncode(sig)}`;
}

/** Returns null for a bad signature, a malformed envelope, or an expired one. */
export function verifySignedValue<T>(token: string | null | undefined): T | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sigB64] = parts;
  const expected = createHmac('sha256', getSessionSecret()).update(b64).digest();
  let provided: Buffer;
  try {
    provided = base64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  try {
    const env = JSON.parse(base64urlDecode(b64).toString('utf8')) as {
      v: T;
      exp?: number;
    };
    if (typeof env.exp !== 'number' || env.exp < Math.floor(Date.now() / 1000)) return null;
    return env.v ?? null;
  } catch {
    return null;
  }
}

/**
 * Sets the admin session cookie. The cookie value is a signed payload that
 * binds the session to a specific Member (by id + name). 8h lifetime.
 */
export function setAdminCookie(res: NextResponse, memberId: string, name: string, groupId: string = BPM_GROUP_ID): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    memberId,
    name,
    groupId,
    typ: 'admin',
    iat: now,
    exp: now + COOKIE_MAX_AGE_S,
  };
  res.cookies.set(COOKIE_NAME, signPayload(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_S,
    path: COOKIE_PATH,
  });
}

export function clearAdminCookie(res: NextResponse): void {
  appendClearCookie(res, COOKIE_NAME);
}

// ── Member session ──
// A non-admin "this device is authenticated as <member>" cookie. Same signed
// payload + flags as the admin cookie, and a DISTINCT name — but the NAME is
// not what keeps them apart, because the client picks which cookie it sends a
// value in. What keeps them apart is the `typ` claim inside the signature:
// `isAdminAuthed` demands `typ === 'admin'`, so a member token replayed as
// `admin_session` fails the signature-only check it used to pass.
//
// Purpose: a PIN'd member proves their PIN once per device (via /recover or the
// Home sign-in path); this cookie then lets the sign-up endpoint register them
// for future sessions without re-entering the PIN. 30-day TTL matches the admin
// cookie and the `badminton_identity` localStorage longevity. Revoked on
// sign-out (cleared alongside the admin cookie).
const MEMBER_COOKIE_NAME = 'member_session';

/**
 * `sameSite: 'lax'`, not `'strict'`.
 *
 * A Strict cookie is not sent on a cross-site navigation, and an OAuth callback
 * (Google, Apple) is exactly that. Chrome evaluates the WHOLE redirect chain,
 * so a Strict session cookie set by a provider callback and then redirected to
 * `/bpm` never reaches the landing request — the user would hold a perfectly
 * valid session while the page rendered signed-out, which is indistinguishable
 * from a broken sign-in.
 *
 * Lax still blocks cross-site POST and subresource sends, which is the CSRF
 * property that matters here: every mutating route in this app is
 * POST/PATCH/DELETE with a JSON content type, and a simple cross-site form
 * cannot produce that.
 */
const COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: COOKIE_PATH,
};

export function setMemberCookie(res: NextResponse, memberId: string, name: string, groupId: string = BPM_GROUP_ID): void {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    memberId,
    name,
    groupId,
    typ: 'member',
    iat: now,
    exp: now + COOKIE_MAX_AGE_S,
  };
  res.cookies.set(MEMBER_COOKIE_NAME, signPayload(payload), {
    ...COOKIE_OPTS,
    maxAge: COOKIE_MAX_AGE_S,
  });
}

export function clearMemberCookie(res: NextResponse): void {
  appendClearCookie(res, MEMBER_COOKIE_NAME);
}

/**
 * Verifies the `member_session` cookie (signature + expiry only — identity
 * proof, NO role/authorization). Returns the bound member identity or null.
 * Never grants admin. Cheap; no Cosmos round-trip.
 */
/**
 * Who this device WAS signed in as, expiry ignored — signature and shape still
 * verified. For one job only: telling the owner of a doc on a lapsed 30-day
 * `member_session` apart from an anonymous reader, so a redaction marker can
 * be sent to the former and never to the latter. It grants nothing; a caller
 * that needs authorization uses `verifyMemberAuth`.
 */
export interface MemberSession {
  memberId: string;
  name: string;
  /** The claim, or BPM for a cookie that predates it. Only meaningful with the flag on. */
  groupId: string;
}

const sessionOf = (p: SessionPayload): MemberSession => ({
  memberId: p.memberId,
  name: p.name,
  groupId: p.groupId ?? BPM_GROUP_ID,
});

export function peekMemberSession(req: NextRequest): MemberSession | null {
  const cookie = req.cookies.get(MEMBER_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const payload = verifyToken(cookie, 'member', { ignoreExpiry: true });
  if (!payload) return null;
  return sessionOf(payload);
}

export function verifyMemberAuth(req: NextRequest): MemberSession | null {
  const cookie = req.cookies.get(MEMBER_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const payload = verifyToken(cookie, 'member');
  if (!payload) return null;
  return sessionOf(payload);
}

/**
 * The group claim of a raw session token — signature and expiry verified,
 * nothing else — for `lib/groupContext.ts`, which resolves a request's group
 * synchronously from either cookie. `null` for anything that does not verify.
 *
 * DELIBERATELY AUDIENCE-AGNOSTIC, and not because "which group" is a lesser
 * question than "is this an admin": `POST /api/admin` mints ONLY an
 * `admin_session`, so a device can hold an admin token and no member token at
 * all, and `resolveGroupId`'s second arm exists to read the claim off exactly
 * that cookie. Demanding `'member'` here would strand those devices in BPM
 * once the multi-group flag is on. Nothing is authorized by this function —
 * the admin decision is `isAdminAuthed` / `isAdminAuthedWithMember`, and both
 * demand `'admin'`.
 */
export function readGroupClaim(token: string | null | undefined): string | null {
  if (!token) return null;
  const payload = verifyToken(token, 'either');
  return payload ? (payload.groupId ?? BPM_GROUP_ID) : null;
}

/** The two session cookie names, for the header-parsing twin in lib/groupContext.ts. */
export const SESSION_COOKIE_NAMES = { member: MEMBER_COOKIE_NAME, admin: COOKIE_NAME } as const;

/**
 * The membership gate for a route that acts INSIDE a group as a signed-in
 * member (Phase 3's group routes; no caller yet). Flag off: any valid
 * `member_session` of an active person is a member of BPM, with `Member.role`
 * as the role. Flag on: the claimed group must hold an ACTIVE membership for
 * this person, and the role comes from it.
 */
export async function requireGroupMember(
  req: NextRequest,
): Promise<(MemberSession & { role: MembershipRole }) | null> {
  const session = verifyMemberAuth(req);
  if (!session) return null;
  try {
    if (!groupsOn()) {
      // Flag off: everyone is in BPM and `Member.role` is the role — the same
      // read `isAdminAuthedWithMember` makes, so a BPM admin is an admin here too.
      const { resource } = await getContainer('members').item(session.memberId, session.memberId).read<Member>();
      if (!resource || resource.active !== true) return null;
      return { ...session, groupId: BPM_GROUP_ID, role: resource.role === 'admin' ? 'admin' : 'member' };
    }
    const m = await readMembership(session.groupId, session.memberId);
    if (!m || m.status !== 'active') return null;
    return { memberId: m.memberId, name: m.name, groupId: m.groupId, role: m.role };
  } catch {
    return null;
  }
}

/**
 * Sync admin check — verifies the cookie's signature, AUDIENCE and expiry only.
 * Does NOT re-check the Member's role. Cheaper, used by read-only routes.
 *
 * The audience is what makes "signature valid" mean something here: the cookie
 * NAME is chosen by the client, so without `typ` this returned true for any
 * signed-in member who replayed their `member_session` value under this name.
 */
export function isAdminAuthed(req: NextRequest): boolean {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return false;
  return verifyToken(cookie, 'admin') !== null;
}

/**
 * The privacy gate for every name-keyed, read-only Stats route: true when the
 * calling device owns `name` (a `member_session` cookie bound to it) or the
 * caller is an admin browsing on someone's behalf.
 *
 * WHY THIS IS A FUNCTION AND NOT A SNIPPET
 * ----------------------------------------
 * These three lines used to be copy-pasted into each route:
 *
 *     const member = verifyMemberAuth(req);
 *     const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
 *     if (!ownsName && !isAdminAuthed(req)) return 403;
 *
 * A snippet can be silently *forgotten*, and it was — three times. `/stats/
 * insight`, `/stats/partners` and `/stats/attendance` all shipped with no auth
 * at all, serving one member's AI coaching prose, social graph and attendance
 * history to any caller (member names are enumerable via the public
 * `GET /api/members`). Nothing failed; the routes just quietly answered.
 *
 * Omission is invisible in review; a missing *call* is at least greppable.
 * `grep -L ownsNameOrAdmin app/api/stats/**\/route.ts` now names every route
 * that does not gate, which is the check a copy-pasted snippet can never give
 * you. Any new name-keyed Stats route must call this — do not re-inline it.
 *
 * Read-only by contract: uses the cheap sync `isAdminAuthed` (no Cosmos
 * round-trip). Mutating routes must use `isAdminAuthedWithMember` instead.
 *
 * Name comparison is trim + lowercase on BOTH sides. Every current call site
 * already parses `name` with `.trim()`, so this is a no-op for them; it exists
 * so a future caller passing a raw query value can't be silently denied.
 */
export function ownsNameOrAdmin(req: NextRequest, name: string): boolean {
  const member = verifyMemberAuth(req);
  const ownsName = member?.name?.trim().toLowerCase() === name.trim().toLowerCase();
  return ownsName || isAdminAuthed(req);
}

/**
 * Async admin check — verifies the cookie AND re-fetches the Member to
 * confirm `role === 'admin' && active === true`. Use in routes that mutate
 * data; protects against role demotion taking effect immediately on the next
 * request rather than on next cookie expiry.
 */
export async function isAdminAuthedWithMember(
  req: NextRequest,
): Promise<{ authed: true; memberId: string; name: string; groupId: string } | { authed: false }> {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (!cookie) return { authed: false };
  const payload = verifyToken(cookie, 'admin');
  if (!payload) return { authed: false };

  try {
    const container = getContainer('members');
    const { resource } = await container.item(payload.memberId, payload.memberId).read<Member>();
    // An inactive person is nobody's admin, whichever group the cookie names.
    if (!resource || resource.active !== true) return { authed: false };
    if (!groupsOn()) {
      // Flag off: `Member.role` is the source of truth and the claim is ignored.
      if (resource.role !== 'admin') return { authed: false };
      return { authed: true, memberId: resource.id, name: resource.name, groupId: BPM_GROUP_ID };
    }
    // Flag on: the role lives on the membership IN THE CLAIMED GROUP. A demotion
    // there takes effect on the next request, same as `Member.role` did.
    const groupId = payload.groupId ?? BPM_GROUP_ID;
    const m = await readGroupAdmin(groupId, resource.id);
    if (!m) return { authed: false };
    return { authed: true, memberId: resource.id, name: m.name, groupId };
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
