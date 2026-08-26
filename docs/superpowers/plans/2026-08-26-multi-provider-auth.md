# Multi-Provider Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people create an account with email + password, Sign in with Google, or Sign in with Apple, while existing name + PIN members keep working untouched and are nudged — never forced — to add a stronger credential.

**Architecture:** Identity stays name-keyed. The new providers are a *credential layer* that resolves to the existing `memberId`, so every sign-in path terminates at the same `setMemberCookie(res, member.id, member.name)` call that `/api/players/recover` already makes. A new `identities` container (PK `/id`) maps `google:<sub>` / `apple:<sub>` / `email:<normalized>` → `memberId` via point reads, and doubles as the atomic uniqueness mechanism because `items.create()` throws 409 on a duplicate id. `arctic@3.7.0` performs the OAuth handshake only; it never owns a session.

**Tech Stack:** Next.js 16.3 App Router, TypeScript, Cosmos DB (in-memory mock for tests), Vitest, `arctic@3.7.0`, `nodemailer` (already installed) over the already-configured Gmail SMTP transport.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-provider-auth-design.md`

## Global Constraints

- **Never re-key identity on email.** `LOWER(c.name)` is the join key in `players`, `skills`, `members`, `stats/attendance`, `stats/club/bands`, `stats/insight`, `admin`, `recover`, `reset-access`, `lib/memberResolve.ts`. Do not touch those queries.
- **Additive-and-optional schema only.** A rollback redeploys older code against the same live DB.
- **Rate limit first in every handler**, before auth and before body parsing (security rule 4).
- **Mutating admin routes** use `await isAdminAuthedWithMember(req)`; read-only may use sync `isAdminAuthed(req)`.
- **IDs use `randomBytes` from `crypto`** — never `Math.random()`.
- **Strip-canaries:** `passwordHash`, `emailVerification`, `passwordReset` are never returned anywhere. `email` and `linkedProviders` are stripped from every list/cross-member response but returned by `GET /api/members/me` for the caller's own record.
- **Cosmos `container.item(docId, partitionKeyValue)`** — second arg is the partition key VALUE. For `identities`, PK is `/id`, so it is `container.item(id, id)`.
- **New containers** must call `ensureContainer(name, partitionKeyPath)` on first handler use (lazy-promise pattern, see `app/api/skills/route.ts`).
- **Flag:** `NEXT_PUBLIC_FLAG_AUTH_PROVIDERS`, `plannedRemoval: '2026-10-15'`. Only the literal string `'true'` means on. Read via `isFlagOn()`, never `process.env` directly.
- **Copy follows the friend-voice principle**: "Add an email so you can get back in if you forget your PIN", never "Upgrade your authentication method."
- **Every task ends with the FULL `npm test` and `npm run lint`.** Baseline is 1794 tests / 195 suites, 0 lint errors / 371 warnings. A *drop* in test count means files failed to load. A new lint ERROR is unambiguous.
- **Node ≥ 22.22.2 required.**

---

## File Structure

**Phase 1 — Foundation**
- Create `lib/passwordHash.ts` — scrypt password hashing, self-describing format. One responsibility: turn a password into a verifiable string and back.
- Create `lib/authIdentity.ts` — the `identities` container: normalize, reserve, look up, release, list. The only module that knows the `id` encoding.
- Create `lib/authSession.ts` — `completeSignIn()`, the single terminus every sign-in path funnels through.
- Modify `lib/auth.ts` — export generic `signValue`/`verifySignedValue`; change `sameSite` on session cookies.
- Modify `lib/types.ts` — new optional `Member` fields.
- Modify `lib/flags.ts` — register the flag.

**Phase 2 — Email + password**
- Create `lib/authToken.ts` — single-use, hashed, expiring tokens (shared by verification and reset).
- Create `lib/authEmail.ts` — the two transactional emails.
- Create `app/api/auth/signup/route.ts`, `signin/route.ts`, `verify-email/route.ts`, `forgot-password/route.ts`, `reset-password/route.ts`.

**Phase 3 — Google**
- Create `lib/oauthState.ts` — state + PKCE cookie handling, per-flow SameSite.
- Create `lib/authResolve.ts` — the resolution decision table, as a **pure function** so it is testable without a browser.
- Create `lib/oauthProviders.ts` — lazily constructed `arctic` clients + redirect URI building.
- Create `lib/pendingSignup.ts` — the signed 10-minute cookie carrying an unclaimed provider identity.
- Create `app/api/auth/google/start/route.ts`, `app/api/auth/google/callback/route.ts`, `app/api/auth/complete-signup/route.ts`.

**Phase 4 — Apple**
- Create `app/api/auth/apple/start/route.ts`, `app/api/auth/apple/callback/route.ts`.

**Phase 5 — UI**
- Create `app/api/auth/methods/route.ts`, `app/api/auth/identity/route.ts` (DELETE / unlink).
- Create `components/auth/SecureAccountCard.tsx`, `components/auth/AuthUpgradeSheet.tsx`, `components/auth/ChooseNameSheet.tsx`, `components/auth/EmailPasswordForm.tsx`, `components/auth/ProviderButtons.tsx`.
- Modify `components/ProfileTab.tsx`, `components/HomeShell.tsx`, `messages/en.json`, `messages/zh-CN.json`.

---

# Phase 1 — Foundation

### Task 1: Password hashing

**Files:**
- Create: `lib/passwordHash.ts`
- Test: `__tests__/passwordHash.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashPassword(password: string): Promise<string>` → `scrypt$N$r$p$saltHex$hashHex`
  - `verifyPassword(password: string, stored: string): Promise<boolean>`
  - `FAKE_PASSWORD_HASH: string`
  - `validatePasswordStrength(password: string): { ok: true } | { ok: false; reason: string }`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/passwordHash.test.ts
import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  FAKE_PASSWORD_HASH,
} from '../lib/passwordHash';

describe('passwordHash', () => {
  it('round-trips a password', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong horse battery', stored)).toBe(false);
  });

  it('stores parameters in the hash so they can change later', async () => {
    const stored = await hashPassword('correct horse battery');
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBe(65536);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('salts, so two hashes of the same password differ', async () => {
    expect(await hashPassword('same password here')).not.toBe(
      await hashPassword('same password here'),
    );
  });

  it('returns false for malformed stored values instead of throwing', async () => {
    for (const bad of ['', 'garbage', 'scrypt$1$2$3', 'scrypt$x$8$1$aa$bb', 'a:b']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('never matches against FAKE_PASSWORD_HASH', async () => {
    expect(await verifyPassword('anything at all', FAKE_PASSWORD_HASH)).toBe(false);
    expect(FAKE_PASSWORD_HASH.startsWith('scrypt$')).toBe(true);
  });

  it('rejects short and common passwords', () => {
    expect(validatePasswordStrength('short').ok).toBe(false);
    expect(validatePasswordStrength('password').ok).toBe(false);
    expect(validatePasswordStrength('12345678901').ok).toBe(false);
    expect(validatePasswordStrength('correct horse battery').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/passwordHash.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/passwordHash"`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/passwordHash.ts
/**
 * Password hashing for the email+password provider.
 *
 * Deliberately separate from `lib/recoveryHash.ts` (PINs). Two reasons:
 * touching that module would invalidate every stored PIN, and its bare
 * `salt:hash` format cannot survive a cost-parameter change — there is nowhere
 * to record which parameters produced a given hash. This format is
 * self-describing, so N can be raised later without locking anyone out.
 *
 * Cost: N=2^16, r=8, p=1 => 128 * N * r = 64 MiB per hash. OWASP's floor is
 * N=2^17, but this runs on a small Azure App Service instance and 2^17 would
 * mean 128 MiB per concurrent sign-in. Sign-in is rare for a friend group;
 * memory is the binding constraint. Node's default scrypt maxmem is 32 MiB and
 * THROWS above it, so maxmem must be passed explicitly.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SCHEME = 'scrypt';
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 128 * N * R * 2; // 128 MiB headroom; scrypt needs 128*N*r

const MIN_LENGTH = 10;

/** Passwords so common that length alone does not make them safe. */
const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678901',
  'qwertyuiop', 'letmein123', 'iloveyou12', 'admin12345', 'welcome123',
  'badminton1', 'shuttlecock',
]);

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = derive(password, salt);
  return `${SCHEME}$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Constant-time. Returns false for any malformed stored value rather than throwing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [scheme, nStr, rStr, pStr, saltHex, hashHex] = parts;
  if (scheme !== SCHEME) return false;
  const n = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 || (n & (n - 1)) !== 0) return false; // must be a power of two
  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  let candidate: Buffer;
  try {
    candidate = scryptSync(password, salt, KEY_LENGTH, {
      N: n, r, p, maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/**
 * Verifying against this takes the same wall-clock time as a real failed
 * verification, so timing cannot distinguish "no account for that email" from
 * "wrong password". Mirrors `FAKE_HASH` in lib/recoveryHash.ts.
 */
export const FAKE_PASSWORD_HASH: string = (() => {
  const salt = Buffer.from('00000000000000000000000000000000', 'hex');
  const hash = derive('__never_match__', salt);
  return `${SCHEME}$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
})();

/**
 * Length plus a common-password blocklist. No composition rules — they push
 * people toward `Passw0rd!`, which is weaker than a long ordinary phrase.
 */
export function validatePasswordStrength(
  password: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_LENGTH} characters.` };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'That password is too long.' };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, reason: 'That password is too easy to guess.' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/passwordHash.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: 1794+ tests pass, 0 lint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/passwordHash.ts __tests__/passwordHash.test.ts
git commit -F - <<'MSG'
feat(auth): scrypt password hashing with a self-describing stored format

Separate from recoveryHash (PINs): touching that would invalidate every
stored PIN, and its bare salt:hash format has nowhere to record which cost
parameters produced a hash, so N could never be raised.

N=2^16 (64 MiB/hash) rather than OWASP's 2^17 floor because the app runs on a
small App Service instance; maxmem is passed explicitly since Node's 32 MiB
default throws above N=2^15.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 2: The `identities` container

**Files:**
- Create: `lib/authIdentity.ts`
- Test: `__tests__/authIdentity.test.ts`

**Interfaces:**
- Consumes: `getContainer`, `ensureContainer` from `lib/cosmos.ts`.
- Produces:
  - `type AuthProvider = 'google' | 'apple' | 'email'`
  - `interface AuthIdentity { id: string; provider: AuthProvider; memberId: string; createdAt: string; lastUsedAt?: string }`
  - `normalizeEmail(email: string): string`
  - `identityId(provider: AuthProvider, key: string): string`
  - `lookupIdentity(provider, key): Promise<AuthIdentity | null>`
  - `reserveIdentity(provider, key, memberId): Promise<{ ok: true; identity: AuthIdentity } | { ok: false; reason: 'taken' }>`
  - `releaseIdentity(provider, key): Promise<void>`
  - `listIdentitiesForMember(memberId): Promise<AuthIdentity[]>`
  - `touchIdentity(provider, key): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/authIdentity.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockStore } from './helpers';
import {
  normalizeEmail,
  identityId,
  lookupIdentity,
  reserveIdentity,
  releaseIdentity,
  listIdentitiesForMember,
} from '../lib/authIdentity';

beforeEach(() => resetMockStore());

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Grant@Example.COM ')).toBe('grant@example.com');
  });
  it('does not strip gmail dots or plus tags', () => {
    // Two different people can legitimately own these on non-Gmail hosts.
    expect(normalizeEmail('a.b+tag@example.com')).toBe('a.b+tag@example.com');
  });
});

describe('identityId', () => {
  it('namespaces by provider so a google sub cannot collide with an apple sub', () => {
    expect(identityId('google', '12345')).toBe('google:12345');
    expect(identityId('apple', '12345')).toBe('apple:12345');
    expect(identityId('email', 'A@B.com')).toBe('email:a@b.com');
  });
});

describe('reserveIdentity', () => {
  it('reserves an unused key and finds it again', async () => {
    const res = await reserveIdentity('google', 'sub-1', 'member-1');
    expect(res.ok).toBe(true);
    const found = await lookupIdentity('google', 'sub-1');
    expect(found?.memberId).toBe('member-1');
    expect(found?.provider).toBe('google');
  });

  it('refuses a key already taken by another member (atomic uniqueness)', async () => {
    await reserveIdentity('email', 'grant@example.com', 'member-1');
    const second = await reserveIdentity('email', 'GRANT@example.com', 'member-2');
    expect(second).toEqual({ ok: false, reason: 'taken' });
    expect((await lookupIdentity('email', 'grant@example.com'))?.memberId).toBe('member-1');
  });

  it('is idempotent when the same member re-reserves the same key', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    const again = await reserveIdentity('google', 'sub-1', 'member-1');
    expect(again.ok).toBe(true);
  });

  it('returns null for a key that was never reserved', async () => {
    expect(await lookupIdentity('apple', 'nope')).toBeNull();
  });
});

describe('releaseIdentity + listIdentitiesForMember', () => {
  it('lists every identity for one member and not other members', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    await reserveIdentity('email', 'grant@example.com', 'member-1');
    await reserveIdentity('apple', 'sub-2', 'member-2');
    const mine = await listIdentitiesForMember('member-1');
    expect(mine.map((i) => i.provider).sort()).toEqual(['email', 'google']);
  });

  it('frees the key so it can be reserved by someone else', async () => {
    await reserveIdentity('google', 'sub-1', 'member-1');
    await releaseIdentity('google', 'sub-1');
    expect(await lookupIdentity('google', 'sub-1')).toBeNull();
    expect((await reserveIdentity('google', 'sub-1', 'member-2')).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/authIdentity.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/authIdentity"`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/authIdentity.ts
/**
 * The `identities` container: the credential layer that resolves a provider
 * identity to an existing `memberId`.
 *
 * WHY A CONTAINER AND NOT AN ARRAY ON THE MEMBER
 * ----------------------------------------------
 * Two properties earn the extra container, and an array on `Member` has
 * neither:
 *
 * 1. The OAuth callback lookup is a POINT READ. `id` is both the document id
 *    and the partition key, so `google:<sub>` -> memberId is the cheapest
 *    operation Cosmos offers, on the hottest path in the flow. An array would
 *    force a cross-partition scan of `members` on every sign-in.
 *
 * 2. `items.create()` gives ATOMIC UNIQUENESS. Cosmos has no unique constraint
 *    across partitions, so "is this email already taken?" cannot be answered by
 *    a query without a race between the check and the write. Creating the
 *    document IS the check: a duplicate id throws 409. That is why the email
 *    reservation lives here rather than as a field on the member.
 *
 * This module is the ONLY place that knows the `<provider>:<key>` encoding.
 */
import { getContainer, ensureContainer } from '@/lib/cosmos';

export type AuthProvider = 'google' | 'apple' | 'email';

export interface AuthIdentity {
  id: string;
  provider: AuthProvider;
  memberId: string;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * Lowercase + trim only. Deliberately does NOT strip dots or `+tags`: that
 * canonicalization is Gmail-specific, and applying it universally would merge
 * two genuinely different mailboxes on hosts that treat them as distinct.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function identityId(provider: AuthProvider, key: string): string {
  const normalized = provider === 'email' ? normalizeEmail(key) : key.trim();
  return `${provider}:${normalized}`;
}

// Lazy one-shot container bootstrap — real Cosmos does not auto-create
// containers the way the mock store does. Same pattern as app/api/skills.
let ensured: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!ensured) ensured = ensureContainer('identities', '/id');
  return ensured;
}

export async function lookupIdentity(
  provider: AuthProvider,
  key: string,
): Promise<AuthIdentity | null> {
  await ready();
  const id = identityId(provider, key);
  try {
    // PK path is `/id`, so the partition key VALUE is the id itself.
    const { resource } = await getContainer('identities').item(id, id).read<AuthIdentity>();
    return resource ?? null;
  } catch {
    return null;
  }
}

export async function reserveIdentity(
  provider: AuthProvider,
  key: string,
  memberId: string,
): Promise<{ ok: true; identity: AuthIdentity } | { ok: false; reason: 'taken' }> {
  await ready();
  const id = identityId(provider, key);
  const identity: AuthIdentity = {
    id,
    provider,
    memberId,
    createdAt: new Date().toISOString(),
  };
  try {
    const { resource } = await getContainer('identities').items.create(identity);
    return { ok: true, identity: (resource as AuthIdentity) ?? identity };
  } catch (err) {
    if ((err as { code?: number })?.code !== 409) throw err;
    // Already exists. Idempotent when it is the SAME member re-reserving —
    // otherwise the key belongs to someone else and must not be stolen.
    const existing = await lookupIdentity(provider, key);
    if (existing && existing.memberId === memberId) return { ok: true, identity: existing };
    return { ok: false, reason: 'taken' };
  }
}

export async function releaseIdentity(provider: AuthProvider, key: string): Promise<void> {
  await ready();
  const id = identityId(provider, key);
  try {
    await getContainer('identities').item(id, id).delete();
  } catch {
    // Already gone is the desired end state.
  }
}

export async function listIdentitiesForMember(memberId: string): Promise<AuthIdentity[]> {
  await ready();
  const { resources } = await getContainer('identities')
    .items.query<AuthIdentity>({
      query: 'SELECT * FROM c WHERE c.memberId = @memberId',
      parameters: [{ name: '@memberId', value: memberId }],
    })
    .fetchAll();
  return resources ?? [];
}

export async function touchIdentity(provider: AuthProvider, key: string): Promise<void> {
  const existing = await lookupIdentity(provider, key);
  if (!existing) return;
  try {
    await getContainer('identities').items.upsert({
      ...existing,
      lastUsedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort telemetry; never fail a sign-in over it.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/authIdentity.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add lib/authIdentity.ts __tests__/authIdentity.test.ts
git commit -F - <<'MSG'
feat(auth): identities container mapping provider identity to memberId

id is both document id and partition key, so a callback lookup is a point
read rather than a cross-partition scan, and items.create() 409 gives atomic
uniqueness for emails and provider subs -- Cosmos has no cross-partition
unique constraint, so a query-then-write would race.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 3: `Member` fields, flag, and strip sites

**Files:**
- Modify: `lib/types.ts` (the `Member` interface, after `statsPrivacy`)
- Modify: `lib/flags.ts` (`FlagName` union + `FLAGS` record)
- Modify: `app/api/members/route.ts` (every strip site — search `pinHash: _ph`)
- Modify: `app/api/players/route.ts` (same)
- Test: `__tests__/auth-strip-canary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the optional `Member` fields every later task writes; `'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'` added to `FlagName`.

- [ ] **Step 1: Find every existing strip site**

Run: `grep -rn "pinHash: _ph" app lib`
Record the list — every one of them must also strip the new fields.

- [ ] **Step 2: Write the failing test**

```ts
// __tests__/auth-strip-canary.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * `email`, `passwordHash`, `emailVerification` and `passwordReset` are
 * strip-canaries in the same family as `pinHash`. This test is structural
 * rather than behavioural on purpose: the failure mode is a NEW endpoint that
 * forgets to strip, and no behavioural test of existing routes can catch that.
 * Mirrors the reasoning behind ownsNameOrAdmin() in lib/auth.ts.
 */
describe('auth strip canary', () => {
  const stripSites = execSync('grep -rl "pinHash: _ph" app lib', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  it('finds the known strip sites', () => {
    expect(stripSites.length).toBeGreaterThan(0);
  });

  it.each(stripSites)('%s strips the new secret fields alongside pinHash', (file) => {
    const src = readFileSync(file, 'utf8');
    const stripBlocks = src.split('pinHash: _ph').slice(1);
    for (const block of stripBlocks) {
      const head = block.slice(0, 400);
      expect(head, `${file}: destructure near pinHash must also drop passwordHash`).toContain(
        'passwordHash: _pw',
      );
      expect(head, `${file}: must also drop emailVerification`).toContain('emailVerification: _ev');
      expect(head, `${file}: must also drop passwordReset`).toContain('passwordReset: _pr');
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/auth-strip-canary.test.ts`
Expected: FAIL — the existing destructures contain `pinHash: _ph` but not `passwordHash: _pw`.

- [ ] **Step 4: Add the `Member` fields**

In `lib/types.ts`, inside `interface Member`, after `statsPrivacy?: StatsPrivacy;`:

```ts
  /**
   * Account email for the email+password provider, normalized lowercase.
   * NARROW strip-canary: removed from every list and cross-member response,
   * but returned by GET /api/members/me for the caller's OWN record (same
   * exception statsPrivacy already has) so Profile can render who you are.
   */
  email?: string;
  /** True only once a mailed verification link has been redeemed. */
  emailVerified?: boolean;
  /** scrypt, self-describing format from lib/passwordHash.ts. STRIP-CANARY. */
  passwordHash?: string;
  /** SHA-256 of a single-use emailed token. 24h TTL. STRIP-CANARY. */
  emailVerification?: { hash: string; expiresAt: number };
  /** SHA-256 of a single-use emailed token. 1h TTL. STRIP-CANARY. */
  passwordReset?: { hash: string; expiresAt: number };
  /**
   * DISPLAY ONLY — never authoritative. The `identities` container is the
   * source of truth; on a mismatch, believe `identities`. Exists so Profile can
   * render "Google connected" without a second round-trip.
   */
  linkedProviders?: ('google' | 'apple')[];
  /**
   * Upgrade-nudge dismissal. Stored on the MEMBER, not localStorage — a
   * per-device dismissal would re-nag on every device the member owns.
   */
  authNudge?: { dismissedAt: string | null };
```

- [ ] **Step 5: Register the flag**

In `lib/flags.ts`, add to the `FlagName` union:

```ts
  | 'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'
```

and to the `FLAGS` record:

```ts
  NEXT_PUBLIC_FLAG_AUTH_PROVIDERS: {
    description:
      'Email+password sign-up, Sign in with Google, and Sign in with Apple, plus the dismissible upgrade nudge for existing PIN-only members. Gates the UI entry points AND the /api/auth/* routes (read server-side there, since a client flag cannot protect the database). The PIN path is unaffected and is NOT being retired — turning this off restores name+PIN as the only credential with no data migration.',
    owner: 'grant',
    plannedRemoval: '2026-10-15',
  },
```

- [ ] **Step 6: Update every strip site**

At each location found in Step 1, extend the destructure. Example — in `app/api/members/route.ts`, a site currently reading:

```ts
const { pinHash: _ph, recoveryCode: _rc, ...safe } = member;
```

becomes:

```ts
const {
  pinHash: _ph,
  recoveryCode: _rc,
  passwordHash: _pw,
  emailVerification: _ev,
  passwordReset: _pr,
  email: _em,
  ...safe
} = member;
```

**Exception:** in `app/api/members/me/route.ts` the caller reads their own record — keep `email` and `linkedProviders` there, and strip only `passwordHash`, `emailVerification`, `passwordReset`, `pinHash`, `recoveryCode`.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run __tests__/auth-strip-canary.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite + lint**

Run: `npm test && npm run lint`
Expected: no test-count drop. `npx tsc --noEmit` should also be clean — this task changes a widely-imported type.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/flags.ts app/api __tests__/auth-strip-canary.test.ts
git commit -F - <<'MSG'
feat(auth): Member credential fields, NEXT_PUBLIC_FLAG_AUTH_PROVIDERS, strip sites

All fields additive-and-optional so a rollback still builds against the same
live database. email is a NARROW canary: stripped everywhere except
GET /api/members/me for the caller's own record, matching statsPrivacy.

The canary test is structural rather than behavioural because the failure mode
is a future endpoint that forgets to strip, which no test of existing routes
can catch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 4: `completeSignIn` — one terminus for every sign-in path

**Files:**
- Create: `lib/authSession.ts`
- Modify: `app/api/players/recover/route.ts` (delete the local `syncAdminCookie`, import instead)
- Test: `__tests__/authSession.test.ts`

**Interfaces:**
- Consumes: `setMemberCookie`, `setAdminCookie`, `clearAdminCookie` from `lib/auth.ts`.
- Produces: `completeSignIn(res: NextResponse, member: { id: string; name: string; role?: string }): void`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/authSession.test.ts
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { completeSignIn } from '../lib/authSession';

function cookieHeaders(res: NextResponse): string {
  return res.headers.getSetCookie().join('\n');
}

describe('completeSignIn', () => {
  it('issues a member session for any member', () => {
    const res = NextResponse.json({ ok: true });
    completeSignIn(res, { id: 'm1', name: 'Lin', role: 'member' });
    expect(cookieHeaders(res)).toMatch(/member_session=[^;]+;/);
  });

  it('issues an admin session for an admin', () => {
    const res = NextResponse.json({ ok: true });
    completeSignIn(res, { id: 'm1', name: 'Grant', role: 'admin' });
    const headers = cookieHeaders(res);
    expect(headers).toMatch(/member_session=[^;]+;/);
    expect(headers).toMatch(/admin_session=[^;]+;/);
  });

  it('CLEARS a stale admin cookie when a non-admin signs in', () => {
    // The regression this exists to prevent: admin powers persisting across
    // sign-out -> sign-in-as-a-different-player on a shared device.
    const res = NextResponse.json({ ok: true });
    completeSignIn(res, { id: 'm2', name: 'Lin', role: 'member' });
    expect(cookieHeaders(res)).toMatch(/admin_session=;[^\n]*Max-Age=0/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/authSession.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/authSession"`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/authSession.ts
/**
 * The single terminus every sign-in path funnels through — PIN, password,
 * Google, Apple.
 *
 * This logic was a local `syncAdminCookie` inside app/api/players/recover.
 * It moved here BEFORE new sign-in paths were added, because its second branch
 * is not optional: a non-admin signing in must CLEAR any existing
 * `admin_session`, or admin powers persist across sign-out ->
 * sign-in-as-someone-else on a shared device. A new provider callback that
 * forgot that branch would silently re-open the hole.
 *
 * Ordering note: `clearAdminCookie` appends raw Set-Cookie headers by hand
 * (see lib/auth.ts), and `res.cookies.set` re-serializes the whole cookie map
 * — so never call a set* helper AFTER a clear* on the same response. The
 * member cookie is therefore set FIRST.
 */
import { NextResponse } from 'next/server';
import { setMemberCookie, setAdminCookie, clearAdminCookie } from '@/lib/auth';

export function completeSignIn(
  res: NextResponse,
  member: { id: string; name: string; role?: string },
): void {
  setMemberCookie(res, member.id, member.name);
  if (member.role === 'admin') {
    setAdminCookie(res, member.id, member.name);
  } else {
    clearAdminCookie(res);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/authSession.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Replace the local copy in `/recover`**

In `app/api/players/recover/route.ts`, delete the local `syncAdminCookie` function and its doc comment, add `import { completeSignIn } from '@/lib/authSession';`, and replace each `syncAdminCookie(res, member)` call with `completeSignIn(res, member)`. Remove now-unused imports of `setAdminCookie` / `clearAdminCookie` / `setMemberCookie` if nothing else in the file uses them.

- [ ] **Step 6: Full suite + lint**

Run: `npm test && npm run lint`
Expected: the existing `/recover` tests still pass — that is the regression check that the extraction was behaviour-preserving.

- [ ] **Step 7: Commit**

```bash
git add lib/authSession.ts __tests__/authSession.test.ts app/api/players/recover/route.ts
git commit -F - <<'MSG'
refactor(auth): extract completeSignIn so every sign-in path clears stale admin

syncAdminCookie was local to /recover. Its non-admin branch clears any
existing admin_session, without which admin powers persist across sign-out ->
sign-in-as-a-different-player. Extracted BEFORE adding provider callbacks so a
new path cannot silently omit it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

### Task 5: SameSite `Strict` → `Lax` on session cookies

**Files:**
- Modify: `lib/auth.ts` (`COOKIE_OPTS`, `setAdminCookie`, `appendClearCookie`)
- Test: `__tests__/auth-cookie-samesite.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: session cookies that survive an OAuth callback redirect.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/auth-cookie-samesite.test.ts
import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { setMemberCookie, setAdminCookie, clearMemberCookie } from '../lib/auth';

/**
 * A Strict cookie is NOT sent on a cross-site navigation, and an OAuth callback
 * is exactly that. Chrome evaluates the whole redirect chain, so a Strict
 * member_session set by the callback and then redirected to /bpm is not sent on
 * the landing request: the user is signed in and the page renders signed-out.
 *
 * Lax still blocks cross-site POST and subresource sends, which is the CSRF
 * protection that matters -- every mutating route here is POST/PATCH/DELETE
 * with a JSON content type, which is not reachable by a simple cross-site form.
 */
describe('session cookie SameSite', () => {
  it('member_session is Lax so it survives an OAuth callback redirect', () => {
    const res = NextResponse.json({ ok: true });
    setMemberCookie(res, 'm1', 'Lin');
    const header = res.headers.getSetCookie().find((c) => c.startsWith('member_session='))!;
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/Path=\/bpm/);
  });

  it('admin_session is Lax for the same reason', () => {
    const res = NextResponse.json({ ok: true });
    setAdminCookie(res, 'm1', 'Grant');
    const header = res.headers.getSetCookie().find((c) => c.startsWith('admin_session='))!;
    expect(header).toMatch(/SameSite=lax/i);
  });

  it('the clear header matches, or the browser will not delete the cookie', () => {
    const res = NextResponse.json({ ok: true });
    clearMemberCookie(res);
    const headers = res.headers.getSetCookie().filter((c) => c.startsWith('member_session='));
    expect(headers.length).toBe(2); // /bpm and the legacy / path
    for (const h of headers) expect(h).toMatch(/SameSite=Lax/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/auth-cookie-samesite.test.ts`
Expected: FAIL — headers say `SameSite=strict`.

- [ ] **Step 3: Change the three sites**

In `lib/auth.ts`:

```ts
const COOKIE_OPTS = {
  httpOnly: true as const,
  // Lax, not Strict: an OAuth callback is a cross-site navigation, and a Strict
  // cookie is not sent on one. Chrome evaluates the whole redirect chain, so a
  // Strict session cookie set by a provider callback and then redirected to
  // /bpm never reaches the landing request -- the user would be signed in on
  // the server and signed-out on screen. Lax still blocks cross-site POST and
  // subresource sends, which is the CSRF property that matters here.
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: COOKIE_PATH,
};
```

In `setAdminCookie`, change `sameSite: 'strict'` to `sameSite: 'lax'`.

In `appendClearCookie`, change the hand-built header's `SameSite=Strict` to `SameSite=Lax` — a clear header whose attributes do not match the original will not delete the cookie.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/auth-cookie-samesite.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: any existing test asserting `SameSite=Strict` fails here — update it to `Lax` and note why in the commit.

- [ ] **Step 6: Commit**

```bash
git add lib/auth.ts __tests__/auth-cookie-samesite.test.ts
git commit -F - <<'MSG'
fix(auth): session cookies SameSite Strict -> Lax for OAuth callbacks

A Strict cookie is not sent on a cross-site navigation and an OAuth callback is
one; Chrome evaluates the whole redirect chain, so a Strict member_session set
by a callback and redirected to /bpm never reaches the landing request and the
page renders signed-out despite a valid session.

The clear header changes too -- a clear whose attributes do not match the
original does not delete the cookie.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
```

---

**Phase 1 gate:** `npm test && npm run lint && npx tsc --noEmit` all clean before starting Phase 2. Phase 1 ships no user-visible change — it is pure foundation, and that is intentional: every later phase depends on all five pieces.

---

*Phases 2–5 continue in `2026-08-26-multi-provider-auth-phase2plus.md`.*
