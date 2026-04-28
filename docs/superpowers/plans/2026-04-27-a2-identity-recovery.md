# A2 Identity Recovery Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a player-facing recovery path (opt-in PIN + admin-mediated 6-digit code) so a lost-device or cleared-cache player can restore access without manual admin DB edits.

**Architecture:** Two new server endpoints (`POST /api/players/recover`, `POST /api/players/reset-access`) and one extended PATCH (`pin` field on existing `app/api/players/route.ts`). Recovery codes live in an in-memory map keyed by playerId (15-min TTL). PINs are hashed via Node's built-in `crypto.scryptSync` to avoid a new dependency. New `<ProfileTab>` becomes the canonical surface for identity management; the bottom nav drops Admin from the bar but keeps it reachable via a "Admin tools →" link inside Profile. Constant-time response (dummy scrypt against a fake hash + rate-limit buckets for non-existent names) closes the name-enumeration leak. Whole feature gates behind `NEXT_PUBLIC_FLAG_RECOVERY`.

**Tech Stack:** TypeScript, Next.js 16 App Router, Node `crypto.scryptSync`, in-memory `Map`, Cosmos DB (`players` container, partition key `/sessionId`), `next-intl`, vitest, `@testing-library/react`.

---

## File Map

**New files (15):**

| Path | Responsibility |
|---|---|
| `lib/recoveryHash.ts` | scrypt-based hash + verify; `FAKE_HASH` constant for constant-time miss |
| `lib/recoveryCodes.ts` | in-memory `Map<playerId, ActiveCode>` with TTL + single-use semantics |
| `lib/recoveryAudit.ts` | append `RecoveryEvent` to player doc, cap at 200, drop oldest |
| `app/api/players/recover/route.ts` | `POST` — validates PIN or code, mints fresh `deleteToken`, constant-time |
| `app/api/players/reset-access/route.ts` | `POST` — admin issues a single 6-digit code, 15-min TTL |
| `components/ProfileTab.tsx` | state-driven Profile (anonymous / player / admin / both) |
| `components/RecoverySheet.tsx` | bottom sheet with two paths (PIN, code) |
| `components/admin/ResetAccessSheet.tsx` | bottom sheet shown after admin issues a code |
| `components/PinInput.tsx` | reusable 4-digit / 6-digit numeric input |
| `__tests__/players-recover.test.ts` | API tests for `/recover` |
| `__tests__/players-reset-access.test.ts` | API tests for `/reset-access` |
| `__tests__/components/ProfileTab.test.tsx` | component tests |
| `__tests__/components/RecoverySheet.test.tsx` | component tests |
| `__tests__/recoveryHash.test.ts` | unit tests for the hash helper |
| `__tests__/recoveryCodes.test.ts` | unit tests for the in-memory store |

**Modified files (10):**

| Path | What changes |
|---|---|
| `lib/types.ts` | add `pinHash?: string` and `recoveryEvents?: RecoveryEvent[]` to `Player` |
| `lib/flags.ts` | register `NEXT_PUBLIC_FLAG_RECOVERY` |
| `app/api/players/route.ts` | POST accepts optional `pin`; PATCH accepts `pin` field; canary strips `pinHash` |
| `app/page.tsx` | `Tab` type adds `'profile'`; render ProfileTab; preserve `?tab=admin` deep link |
| `components/BottomNav.tsx` | replace Admin slot with Profile in the bar |
| `components/HomeTab.tsx` | sign-up form gains opt-in PIN checkbox |
| `components/admin/AdminDashboard.tsx` | add "Reset access" button to active player rows |
| `messages/en.json` | new keys: `nav.profile`, `profile.*`, `recovery.*`, `pin.*` |
| `messages/zh-CN.json` | mirrored translations |
| `CLAUDE.md` | update "4 tabs" gotcha; document recovery flow + flag |

---

## Conventions reused (do not re-invent)

- **Rate limit:** `checkRateLimit(key, maxRequests, windowMs)` from `lib/rateLimit.ts`. IP via `getClientIp(req)`.
- **Admin auth:** `isAdminAuthed(req)` + `unauthorized()` from `lib/auth.ts`.
- **Cosmos:** `getContainer('players').item(docId, sessionId)` — partition key value, not doc id.
- **Stripping secrets in responses:** existing pattern in `app/api/players/route.ts:205` strips `deleteToken`. Mirror for `pinHash`.
- **Flag reading:** always `isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')` — never raw `process.env`.
- **Tests:** in-memory mock store (no DB); unique `X-Client-IP` per test per `__tests__/helpers.ts`; `<NextIntlClientProvider locale="en" messages={enMessages}>` wrapper for components; manual `cleanup()` between component cases.

---

## Phase 1 — Schema, hashing, server primitives

### Task 1: Register flag + extend Player type

**Files:**
- Modify: `lib/flags.ts:18-22, 30-51`
- Modify: `lib/types.ts` (add to `Player` interface)

- [ ] **Step 1: Add to FlagName union**

In `lib/flags.ts:18-22`, add the new flag to the union:

```typescript
export type FlagName =
  | 'NEXT_PUBLIC_FLAG_DEMO'
  | 'NEXT_PUBLIC_FLAG_STAGE0_NEW_NAV'
  | 'NEXT_PUBLIC_FLAG_DESIGN_PREVIEW'
  | 'NEXT_PUBLIC_FLAG_STATS_ATTENDANCE'
  | 'NEXT_PUBLIC_FLAG_RECOVERY';
```

- [ ] **Step 2: Add to FLAGS registry**

In `lib/flags.ts:30-51`, add the new entry:

```typescript
  NEXT_PUBLIC_FLAG_RECOVERY: {
    description: 'A2 identity recovery: opt-in PIN at sign-up, set/change PIN in Profile, admin-mediated 6-digit code. Off on bpm-stable, on for bpm-next + dev.',
    owner: 'grant',
    plannedRemoval: 'two weeks after promotion to bpm-stable',
  },
```

- [ ] **Step 3: Extend readFlag switch**

In `lib/flags.ts:53-64`, add the case:

```typescript
    case 'NEXT_PUBLIC_FLAG_RECOVERY':
      return process.env.NEXT_PUBLIC_FLAG_RECOVERY;
```

- [ ] **Step 4: Extend Player type**

In `lib/types.ts`, locate the `Player` interface and add:

```typescript
export type RecoveryEvent =
  | { event: 'pin-set'; at: string }
  | { event: 'pin-removed'; at: string }
  | { event: 'reset-access-issued'; at: string; admin: 'admin' }
  | { event: 'recovered-via-pin'; at: string }
  | { event: 'recovered-via-code'; at: string }
  | { event: 'recovery-failed'; at: string; reason: 'wrong_pin' | 'wrong_code' | 'expired_code' };

// Inside the existing Player interface:
//   pinHash?: string;
//   recoveryEvents?: RecoveryEvent[];
```

Add `pinHash?: string` and `recoveryEvents?: RecoveryEvent[]` as optional fields on `Player`.

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/flags.ts lib/types.ts
git commit -m "feat(a2): register NEXT_PUBLIC_FLAG_RECOVERY + Player schema fields"
```

---

### Task 2: Hashing module (scrypt-based)

**Files:**
- Create: `lib/recoveryHash.ts`
- Test: `__tests__/recoveryHash.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/recoveryHash.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin, FAKE_HASH } from '../lib/recoveryHash';

describe('recoveryHash', () => {
  it('hashes a PIN and verifies it', async () => {
    const hash = await hashPin('1234');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPin('1234', hash)).toBe(true);
    expect(await verifyPin('5678', hash)).toBe(false);
  });

  it('produces different hashes for the same PIN (salt)', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a).not.toBe(b);
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1234', b)).toBe(true);
  });

  it('FAKE_HASH never verifies any input', async () => {
    expect(await verifyPin('0000', FAKE_HASH)).toBe(false);
    expect(await verifyPin('1234', FAKE_HASH)).toBe(false);
  });

  it('rejects malformed hash strings', async () => {
    expect(await verifyPin('1234', 'not-a-hash')).toBe(false);
    expect(await verifyPin('1234', '')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run __tests__/recoveryHash.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/recoveryHash.ts`:

```typescript
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Returns "salt:hash" both hex-encoded.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Constant-time verification. Returns false for any malformed stored value.
 */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let saltBuf: Buffer, expected: Buffer;
  try {
    saltBuf = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (saltBuf.length === 0 || expected.length !== KEY_LENGTH) return false;
  const candidate = scryptSync(pin, saltBuf, KEY_LENGTH, SCRYPT_OPTIONS);
  return timingSafeEqual(candidate, expected);
}

/**
 * Pre-computed hash used by the constant-time miss path on /recover. Verifying
 * any input against this returns false but takes the same wall-clock time as
 * a real failed verification, so an attacker can't distinguish "no player" from
 * "wrong PIN" via timing.
 *
 * Generated once at module load via a known-bad pin + fixed salt.
 */
export const FAKE_HASH: string = (() => {
  const salt = Buffer.from('00000000000000000000000000000000', 'hex');
  const hash = scryptSync('__never_match__', salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
})();
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx vitest run __tests__/recoveryHash.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/recoveryHash.ts __tests__/recoveryHash.test.ts
git commit -m "feat(a2): scrypt-based PIN hash + FAKE_HASH for constant-time miss"
```

---

### Task 3: In-memory recovery code store

**Files:**
- Create: `lib/recoveryCodes.ts`
- Test: `__tests__/recoveryCodes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/recoveryCodes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  issueCode,
  consumeCode,
  invalidateCode,
  __resetForTests,
} from '../lib/recoveryCodes';

describe('recoveryCodes', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a 6-digit numeric code', async () => {
    const { code, expiresAt } = await issueCode('player-1', 'session-2026-04-27');
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('consumes a valid code and returns true once', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    expect(await consumeCode('player-1', code)).toBe(true);
    expect(await consumeCode('player-1', code)).toBe(false);
  });

  it('rejects a wrong code without consuming', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    expect(await consumeCode('player-1', '999999')).toBe(false);
    expect(await consumeCode('player-1', code)).toBe(true);
  });

  it('rejects a code after 15 min', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await consumeCode('player-1', code)).toBe(false);
  });

  it('re-issuing for the same player invalidates the prior code', async () => {
    const first = await issueCode('player-1', 'session-2026-04-27');
    const second = await issueCode('player-1', 'session-2026-04-27');
    expect(first.code).not.toBe(second.code);
    expect(await consumeCode('player-1', first.code)).toBe(false);
    expect(await consumeCode('player-1', second.code)).toBe(true);
  });

  it('invalidateCode removes an active code', async () => {
    const { code } = await issueCode('player-1', 'session-2026-04-27');
    invalidateCode('player-1');
    expect(await consumeCode('player-1', code)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run __tests__/recoveryCodes.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/recoveryCodes.ts`:

```typescript
import { randomInt } from 'crypto';
import { hashPin, verifyPin } from './recoveryHash';

const TTL_MS = 15 * 60 * 1000;

interface ActiveCode {
  playerId: string;
  sessionId: string;
  codeHash: string;
  expiresAt: number;
}

const activeCodes = new Map<string, ActiveCode>();

export async function issueCode(
  playerId: string,
  sessionId: string,
): Promise<{ code: string; expiresAt: number }> {
  const code = String(randomInt(100000, 1000000));
  const codeHash = await hashPin(code);
  const expiresAt = Date.now() + TTL_MS;
  activeCodes.set(playerId, { playerId, sessionId, codeHash, expiresAt });
  return { code, expiresAt };
}

/**
 * Returns true if the candidate matches a still-valid code for this player.
 * On match, the entry is consumed (single-use). On expiry, the entry is
 * deleted as a side effect.
 */
export async function consumeCode(playerId: string, candidate: string): Promise<boolean> {
  const entry = activeCodes.get(playerId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    activeCodes.delete(playerId);
    return false;
  }
  const ok = await verifyPin(candidate, entry.codeHash);
  if (ok) activeCodes.delete(playerId);
  return ok;
}

export function invalidateCode(playerId: string): void {
  activeCodes.delete(playerId);
}

/** Test-only — never call from app code. */
export function __resetForTests(): void {
  activeCodes.clear();
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx vitest run __tests__/recoveryCodes.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/recoveryCodes.ts __tests__/recoveryCodes.test.ts
git commit -m "feat(a2): in-memory 6-digit recovery code store with 15-min TTL"
```

---

### Task 4: Audit log helper

**Files:**
- Create: `lib/recoveryAudit.ts`

- [ ] **Step 1: Implement the module**

Create `lib/recoveryAudit.ts`:

```typescript
import type { RecoveryEvent } from './types';

const MAX_EVENTS = 200;

/**
 * Returns a new array with the event appended. Old entries are dropped first
 * if the cap is exceeded, so the array stays bounded at MAX_EVENTS.
 */
export function appendEvent(
  existing: RecoveryEvent[] | undefined,
  event: RecoveryEvent,
): RecoveryEvent[] {
  const list = existing ?? [];
  const next = [...list, event];
  if (next.length <= MAX_EVENTS) return next;
  return next.slice(next.length - MAX_EVENTS);
}
```

- [ ] **Step 2: Inline test the cap behavior**

Append a quick test in `__tests__/recoveryAudit.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { appendEvent } from '../lib/recoveryAudit';

describe('recoveryAudit.appendEvent', () => {
  it('appends to an empty list', () => {
    const out = appendEvent(undefined, { event: 'pin-set', at: 'now' });
    expect(out).toHaveLength(1);
    expect(out[0].event).toBe('pin-set');
  });

  it('caps at 200 entries by dropping oldest', () => {
    const seed: { event: 'pin-set'; at: string }[] = Array.from({ length: 200 }, (_, i) => ({
      event: 'pin-set' as const,
      at: `t-${i}`,
    }));
    const out = appendEvent(seed, { event: 'pin-removed', at: 'newest' });
    expect(out).toHaveLength(200);
    expect(out[0].at).toBe('t-1'); // oldest dropped
    expect(out[199].at).toBe('newest');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run __tests__/recoveryAudit.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add lib/recoveryAudit.ts __tests__/recoveryAudit.test.ts
git commit -m "feat(a2): recovery audit log helper, cap 200"
```

---

## Phase 2 — API endpoints

### Task 5: `POST /api/players/reset-access` (admin)

**Files:**
- Create: `app/api/players/reset-access/route.ts`
- Test: `__tests__/players-reset-access.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/players-reset-access.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '../app/api/players/reset-access/route';
import { resetMockStore, makeAdminRequest, makeRequest, seedPlayer } from './helpers';
import { __resetForTests } from '../lib/recoveryCodes';

describe('POST /api/players/reset-access', () => {
  beforeEach(() => {
    resetMockStore();
    __resetForTests();
  });

  it('returns 401 for non-admin', async () => {
    const req = makeRequest('http://localhost/api/players/reset-access', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'p1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('mints a 6-digit code for a valid player', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    const req = makeAdminRequest('http://localhost/api/players/reset-access', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'p1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[0-9]{6}$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects a soft-deleted player with 409', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27', removed: true });
    const req = makeAdminRequest('http://localhost/api/players/reset-access', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'p1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('returns 404 when player does not exist', async () => {
    const req = makeAdminRequest('http://localhost/api/players/reset-access', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'ghost' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('rate-limits at 10 requests per admin per hour', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    for (let i = 0; i < 10; i++) {
      const req = makeAdminRequest('http://localhost/api/players/reset-access', {
        method: 'POST',
        body: JSON.stringify({ playerId: 'p1' }),
        headers: { 'X-Client-IP': '10.0.0.42' },
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
    }
    const blocked = makeAdminRequest('http://localhost/api/players/reset-access', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'p1' }),
      headers: { 'X-Client-IP': '10.0.0.42' },
    });
    const res = await POST(blocked);
    expect(res.status).toBe(429);
  });
});
```

If `seedPlayer` and `makeAdminRequest` don't exist in `__tests__/helpers.ts`, add them:

```typescript
// Add to __tests__/helpers.ts
import { getContainer } from '../lib/cosmos';

export async function seedPlayer(player: {
  id: string;
  name: string;
  sessionId: string;
  removed?: boolean;
  pinHash?: string;
  deleteToken?: string;
}): Promise<void> {
  const container = getContainer('players');
  await container.items.upsert({
    timestamp: new Date().toISOString(),
    paid: false,
    waitlisted: false,
    removed: false,
    deleteToken: 'seed-token',
    ...player,
  });
}

// `makeAdminRequest` already exists in helpers if admin tests are present.
// If not, mirror `makeRequest` and inject the admin_session cookie:
//   headers: { Cookie: `admin_session=${expectedAdminCookieValue()}` }
// Reuse whatever existing admin tests use.
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run __tests__/players-reset-access.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/players/reset-access/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { issueCode } from '@/lib/recoveryCodes';
import { appendEvent } from '@/lib/recoveryAudit';
import { isFlagOn } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`reset-access:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!isAdminAuthed(req)) return unauthorized();

  let body: { playerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (typeof body.playerId !== 'string' || !body.playerId) {
    return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 });
  }

  const sessionId = await getActiveSessionId();
  const container = getContainer('players');
  const { resource: player } = await container.item(body.playerId, sessionId).read();
  if (!player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  if (player.removed === true) {
    return NextResponse.json({ error: 'Restore the player first' }, { status: 409 });
  }

  const { code, expiresAt } = await issueCode(player.id, sessionId);

  const updatedEvents = appendEvent(player.recoveryEvents, {
    event: 'reset-access-issued',
    at: new Date().toISOString(),
    admin: 'admin',
  });
  await container.items.upsert({ ...player, recoveryEvents: updatedEvents });

  return NextResponse.json({ code, expiresAt });
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players-reset-access.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Add a flag-off test**

Append to `__tests__/players-reset-access.test.ts`:

```typescript
  it('returns 404 when flag is off', async () => {
    const original = process.env.NEXT_PUBLIC_FLAG_RECOVERY;
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    try {
      await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
      const req = makeAdminRequest('http://localhost/api/players/reset-access', {
        method: 'POST',
        body: JSON.stringify({ playerId: 'p1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    } finally {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = original;
    }
  });
```

- [ ] **Step 6: Run tests again**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players-reset-access.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/api/players/reset-access/route.ts __tests__/players-reset-access.test.ts __tests__/helpers.ts
git commit -m "feat(a2): POST /api/players/reset-access — admin issues 6-digit code"
```

---

### Task 6: `POST /api/players/recover`

**Files:**
- Create: `app/api/players/recover/route.ts`
- Test: `__tests__/players-recover.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/players-recover.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '../app/api/players/recover/route';
import { resetMockStore, makeRequest, makeAdminRequest, seedPlayer } from './helpers';
import { hashPin } from '../lib/recoveryHash';
import { issueCode, __resetForTests } from '../lib/recoveryCodes';

const SESSION = 'session-2026-04-27';

describe('POST /api/players/recover', () => {
  beforeEach(() => {
    resetMockStore();
    __resetForTests();
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });

  it('recovers via correct PIN and returns a fresh deleteToken', async () => {
    const pinHash = await hashPin('1234');
    await seedPlayer({
      id: 'p1', name: 'Michael', sessionId: SESSION,
      pinHash, deleteToken: 'old-token',
    });
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: SESSION, pin: '1234' }),
      headers: { 'X-Client-IP': '10.0.0.1' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleteToken).toMatch(/^[0-9a-f]{32}$/);
    expect(body.deleteToken).not.toBe('old-token');
    expect(body.pinHash).toBeUndefined();
  });

  it('recovers via correct admin code', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: SESSION, deleteToken: 'old' });
    const { code } = await issueCode('p1', SESSION);
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: SESSION, code }),
      headers: { 'X-Client-IP': '10.0.0.2' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('rejects wrong PIN with 401 invalid_credentials', async () => {
    const pinHash = await hashPin('1234');
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: SESSION, pinHash });
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: SESSION, pin: '9999' }),
      headers: { 'X-Client-IP': '10.0.0.3' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_credentials');
  });

  it('returns identical 401 shape for non-existent player (constant-time miss)', async () => {
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ghost', sessionId: SESSION, pin: '1234' }),
      headers: { 'X-Client-IP': '10.0.0.4' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_credentials');
  });

  it('rate-limits real and fake names identically (5 attempts/hr)', async () => {
    await seedPlayer({ id: 'p1', name: 'Real', sessionId: SESSION, pinHash: await hashPin('1234') });

    for (const name of ['Real', 'Fake']) {
      for (let i = 0; i < 5; i++) {
        const r = makeRequest('http://localhost/api/players/recover', {
          method: 'POST',
          body: JSON.stringify({ name, sessionId: SESSION, pin: '0000' }),
          headers: { 'X-Client-IP': `10.0.0.${name === 'Real' ? 5 : 6}` },
        });
        const res = await POST(r);
        expect(res.status).toBe(401);
      }
      const blocked = makeRequest('http://localhost/api/players/recover', {
        method: 'POST',
        body: JSON.stringify({ name, sessionId: SESSION, pin: '0000' }),
        headers: { 'X-Client-IP': `10.0.0.${name === 'Real' ? 5 : 6}` },
      });
      const res = await POST(blocked);
      expect(res.status).toBe(429);
    }
  });

  it('mints a new deleteToken and invalidates the old one', async () => {
    const pinHash = await hashPin('1234');
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: SESSION, pinHash, deleteToken: 'old' });
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: SESSION, pin: '1234' }),
      headers: { 'X-Client-IP': '10.0.0.7' },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.deleteToken).not.toBe('old');

    // Verify the player doc no longer has 'old' as the deleteToken
    const { getContainer } = await import('../lib/cosmos');
    const { resource } = await getContainer('players').item('p1', SESSION).read();
    expect(resource.deleteToken).toBe(body.deleteToken);
  });

  it('rejects when both pin and code are present', async () => {
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', sessionId: SESSION, pin: '1234', code: '123456' }),
      headers: { 'X-Client-IP': '10.0.0.8' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects when neither pin nor code is present', async () => {
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', sessionId: SESSION }),
      headers: { 'X-Client-IP': '10.0.0.9' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects an admin attempting to call /recover', async () => {
    const pinHash = await hashPin('1234');
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: SESSION, pinHash });
    const req = makeAdminRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: SESSION, pin: '1234' }),
      headers: { 'X-Client-IP': '10.0.0.10' },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 404 when flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    const req = makeRequest('http://localhost/api/players/recover', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', sessionId: SESSION, pin: '1234' }),
      headers: { 'X-Client-IP': '10.0.0.11' },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run __tests__/players-recover.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the route**

Create `app/api/players/recover/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { isAdminAuthed } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { consumeCode } from '@/lib/recoveryCodes';
import { appendEvent } from '@/lib/recoveryAudit';
import { isFlagOn } from '@/lib/flags';

export const dynamic = 'force-dynamic';

const FAIL = NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  let body: { name?: unknown; sessionId?: unknown; pin?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const pin = typeof body.pin === 'string' ? body.pin : null;
  const code = typeof body.code === 'string' ? body.code : null;

  if (!name || !sessionId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if ((pin && code) || (!pin && !code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (pin && !/^[0-9]{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (code && !/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Admin must use /reset-access; do not allow /recover to mint tokens for them.
  if (isAdminAuthed(req)) {
    return NextResponse.json({ error: 'Use reset-access' }, { status: 403 });
  }

  const ip = getClientIp(req);
  // Rate-limit BEFORE looking up the player so non-existent names also bucket.
  if (!checkRateLimit(`recover:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: 60 * 60 },
      { status: 429 },
    );
  }

  const container = getContainer('players');
  const { resources } = await container.items
    .query({
      query:
        'SELECT * FROM c WHERE c.sessionId = @sid AND LOWER(c.name) = LOWER(@n) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      parameters: [
        { name: '@sid', value: sessionId },
        { name: '@n', value: name },
      ],
    })
    .fetchAll();
  const player = resources[0];

  // Constant-time miss: do a real verify against FAKE_HASH so the latency
  // matches a real failed verify.
  if (!player) {
    if (pin) await verifyPin(pin, FAKE_HASH);
    else await verifyPin(code!, FAKE_HASH);
    return FAIL;
  }

  let ok = false;
  if (pin) {
    if (typeof player.pinHash === 'string' && player.pinHash) {
      ok = await verifyPin(pin, player.pinHash);
    } else {
      // No PIN set — same dummy verify so latency is constant.
      await verifyPin(pin, FAKE_HASH);
      ok = false;
    }
  } else {
    ok = await consumeCode(player.id, code!);
  }

  if (!ok) {
    const updatedEvents = appendEvent(player.recoveryEvents, {
      event: 'recovery-failed',
      at: new Date().toISOString(),
      reason: pin ? 'wrong_pin' : 'wrong_code',
    });
    await container.items.upsert({ ...player, recoveryEvents: updatedEvents });
    return FAIL;
  }

  const newDeleteToken = randomBytes(16).toString('hex');
  const updatedEvents = appendEvent(player.recoveryEvents, {
    event: pin ? 'recovered-via-pin' : 'recovered-via-code',
    at: new Date().toISOString(),
  });
  await container.items.upsert({
    ...player,
    deleteToken: newDeleteToken,
    recoveryEvents: updatedEvents,
  });

  return NextResponse.json({ deleteToken: newDeleteToken });
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players-recover.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/recover/route.ts __tests__/players-recover.test.ts
git commit -m "feat(a2): POST /api/players/recover with constant-time miss + fresh token"
```

---

### Task 7: Extend PATCH `/api/players` with `pin` field

**Files:**
- Modify: `app/api/players/route.ts:175-256`
- Modify: `__tests__/players.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Append to `__tests__/players.test.ts`:

```typescript
describe('PATCH /api/players — pin field', () => {
  beforeEach(() => {
    resetMockStore();
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });

  it('admin sets a PIN', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    const req = makeAdminRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: '7392' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pinHash).toBeUndefined();
    const { getContainer } = await import('../lib/cosmos');
    const { resource } = await getContainer('players').item('p1', 'session-2026-04-27').read();
    expect(typeof resource.pinHash).toBe('string');
    expect(resource.pinHash.length).toBeGreaterThan(0);
  });

  it('player sets PIN with their own deleteToken', async () => {
    await seedPlayer({
      id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27',
      deleteToken: 'self-token',
    });
    const req = makeRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: '7392', deleteToken: 'self-token' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
  });

  it('rejects PIN set without deleteToken when not admin', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    const req = makeRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: '7392' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('rejects blocklisted PIN', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    const req = makeAdminRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: '0000' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('pin_too_common');
  });

  it('rejects malformed PIN (5 digits)', async () => {
    await seedPlayer({ id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27' });
    const req = makeAdminRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: '12345' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('clears PIN when pin is null', async () => {
    const { hashPin } = await import('../lib/recoveryHash');
    await seedPlayer({
      id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27',
      pinHash: await hashPin('1234'),
    });
    const req = makeAdminRequest('http://localhost/api/players', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'p1', pin: null }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const { getContainer } = await import('../lib/cosmos');
    const { resource } = await getContainer('players').item('p1', 'session-2026-04-27').read();
    expect(resource.pinHash).toBeUndefined();
  });

  it('GET response strips pinHash from every player', async () => {
    const { hashPin } = await import('../lib/recoveryHash');
    await seedPlayer({
      id: 'p1', name: 'Michael', sessionId: 'session-2026-04-27',
      pinHash: await hashPin('1234'),
    });
    const req = makeRequest('http://localhost/api/players?sessionId=session-2026-04-27', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const players = await res.json();
    for (const p of players) {
      expect(p.pinHash).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players.test.ts -t 'pin field'
```

Expected: FAIL.

- [ ] **Step 3: Implement the change**

In `app/api/players/route.ts`, add the blocklist constant near the top of the file (after imports):

```typescript
const BLOCKLISTED_PINS = new Set(['0000', '1111', '1234', '4321', '1212']);
```

Inside `PATCH` (around line 220, where `updates` is built), after the existing `paid`/`removed`/`waitlisted` handling, insert:

```typescript
    // PIN handling — gated on the recovery flag.
    if (body.pin !== undefined) {
      const { isFlagOn } = await import('@/lib/flags');
      if (!isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
      }

      // Auth: admin OR the player themselves with valid deleteToken.
      const isPlayerSelf =
        typeof body.deleteToken === 'string' &&
        existing.deleteToken &&
        existing.deleteToken.length === body.deleteToken.length &&
        timingSafeEqual(Buffer.from(existing.deleteToken), Buffer.from(body.deleteToken));
      if (!isAdmin && !isPlayerSelf) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (body.pin === null) {
        updates.pinHash = undefined;
        const { appendEvent } = await import('@/lib/recoveryAudit');
        updates.recoveryEvents = appendEvent(existing.recoveryEvents, {
          event: 'pin-removed',
          at: new Date().toISOString(),
        });
      } else if (typeof body.pin === 'string') {
        if (!/^[0-9]{4}$/.test(body.pin)) {
          return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
        }
        if (BLOCKLISTED_PINS.has(body.pin)) {
          return NextResponse.json({ error: 'pin_too_common' }, { status: 400 });
        }
        const { hashPin } = await import('@/lib/recoveryHash');
        updates.pinHash = await hashPin(body.pin);
        const { appendEvent } = await import('@/lib/recoveryAudit');
        updates.recoveryEvents = appendEvent(existing.recoveryEvents, {
          event: 'pin-set',
          at: new Date().toISOString(),
        });
      } else {
        return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
      }
    }
```

Then, in the line that strips `deleteToken` before returning (currently around line 251), also strip `pinHash`:

```typescript
    const { deleteToken: _dt, pinHash: _ph, ...safe } = updated as typeof existing;
    return NextResponse.json(safe);
```

Apply the same strip to the GET handler (around `app/api/players/route.ts` GET) — after the existing `deleteToken` strip, also drop `pinHash`. Find where GET maps over players and add the field to the destructure or `delete result.pinHash` after the destructure.

For example, find the existing GET strip pattern and update from:

```typescript
const safe = resources.map(({ deleteToken, ...rest }) => rest);
```

to:

```typescript
const safe = resources.map(({ deleteToken, pinHash, ...rest }) => rest);
```

(adjust to match the exact existing pattern in the file).

- [ ] **Step 4: Run tests to verify pass**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players.test.ts
```

Expected: all existing tests + 7 new ones pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/route.ts __tests__/players.test.ts
git commit -m "feat(a2): PATCH /api/players accepts pin (set/change/remove) + GET strips pinHash"
```

---

### Task 8: POST `/api/players` accepts opt-in PIN at sign-up

**Files:**
- Modify: `app/api/players/route.ts:30-160` (POST handler)
- Modify: `__tests__/players.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Append to `__tests__/players.test.ts`:

```typescript
describe('POST /api/players — opt-in PIN at sign-up', () => {
  beforeEach(() => {
    resetMockStore();
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });

  it('accepts a valid PIN and stores pinHash', async () => {
    const req = makeRequest('http://localhost/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: 'session-2026-04-27', pin: '7392' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pinHash).toBeUndefined();
    expect(body.deleteToken).toBeDefined();
    const { getContainer } = await import('../lib/cosmos');
    const { resources } = await getContainer('players').items
      .query({ query: 'SELECT * FROM c WHERE LOWER(c.name) = "michael"' })
      .fetchAll();
    expect(typeof resources[0].pinHash).toBe('string');
  });

  it('rejects sign-up with blocklisted PIN', async () => {
    const req = makeRequest('http://localhost/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: 'session-2026-04-27', pin: '0000' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('pin_too_common');
  });

  it('signs up without PIN (omitted)', async () => {
    const req = makeRequest('http://localhost/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: 'session-2026-04-27' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('signs up without PIN when flag is off (PIN ignored)', async () => {
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    const req = makeRequest('http://localhost/api/players', {
      method: 'POST',
      body: JSON.stringify({ name: 'Michael', sessionId: 'session-2026-04-27', pin: '7392' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const { getContainer } = await import('../lib/cosmos');
    const { resources } = await getContainer('players').items
      .query({ query: 'SELECT * FROM c WHERE LOWER(c.name) = "michael"' })
      .fetchAll();
    expect(resources[0].pinHash).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players.test.ts -t 'opt-in PIN'
```

Expected: FAIL.

- [ ] **Step 3: Implement the change**

In `app/api/players/route.ts`, inside POST handler, after `trimmedName` is established and before the existing capacity check (around line 75), validate and prep the PIN:

```typescript
    // Optional PIN at sign-up — only honored when the recovery flag is on.
    let pinHash: string | undefined;
    if (typeof body.pin === 'string' && isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')) {
      if (!/^[0-9]{4}$/.test(body.pin)) {
        return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
      }
      if (BLOCKLISTED_PINS.has(body.pin)) {
        return NextResponse.json({ error: 'pin_too_common' }, { status: 400 });
      }
      const { hashPin } = await import('@/lib/recoveryHash');
      pinHash = await hashPin(body.pin);
    }
```

Add `import { isFlagOn } from '@/lib/flags';` at the top of the file if not already present.

Then in the player creation object (around line 144 where `const player = { ... }` is built), add:

```typescript
      ...(pinHash ? { pinHash } : {}),
```

Same for the restore-existing-soft-deleted branch (around line 119) — preserve any newly-set PIN.

Strip `pinHash` in the POST response (find the line near 156 where it returns the new player JSON):

```typescript
    const { deleteToken: _dt, pinHash: _ph, ...safe } = resource as typeof player;
    return NextResponse.json({ ...safe, deleteToken }, { status: 201 });
```

(`deleteToken` is intentionally returned once on the create response; `pinHash` is not.)

- [ ] **Step 4: Run tests to verify pass**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/players.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/route.ts __tests__/players.test.ts
git commit -m "feat(a2): POST /api/players accepts optional PIN at sign-up"
```

---

## Phase 3 — Client surfaces

### Task 9: `<PinInput>` reusable component

**Files:**
- Create: `components/PinInput.tsx`

- [ ] **Step 1: Implement**

Create `components/PinInput.tsx`:

```tsx
'use client';
import { useId } from 'react';

interface Props {
  value: string;
  onChange: (v: string) => void;
  digits: 4 | 6;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaInvalid?: boolean;
}

export default function PinInput({
  value, onChange, digits, label, autoFocus, disabled, ariaInvalid,
}: Props) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        name={`pin-${digits}`}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`[0-9]{${digits}}`}
        maxLength={digits}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, digits))}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={ariaInvalid || undefined}
        placeholder={'•'.repeat(digits)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 28,
          letterSpacing: '0.4em',
          textAlign: 'center',
          padding: '12px 14px',
          borderRadius: 12,
          border: ariaInvalid ? '1px solid var(--color-red, #ef4444)' : '1px solid var(--glass-border)',
          background: 'var(--input-bg, rgba(255,255,255,0.05))',
          color: 'var(--text-primary)',
          width: '100%',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/PinInput.tsx
git commit -m "feat(a2): PinInput component for 4/6-digit numeric inputs"
```

---

### Task 10: `<RecoverySheet>` (PIN + code paths)

**Files:**
- Create: `components/RecoverySheet.tsx`
- Test: `__tests__/components/RecoverySheet.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/RecoverySheet.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RecoverySheet from '../../components/RecoverySheet';
import enMessages from '../../messages/en.json';

const renderWith = (open: boolean, onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RecoverySheet open={open} onClose={onClose} sessionId="session-2026-04-27" />
    </NextIntlClientProvider>,
  );

describe('RecoverySheet', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders both PIN and code paths when open', () => {
    renderWith(true);
    expect(screen.getByText(/I have my PIN/i)).toBeDefined();
    expect(screen.getByText(/Ask admin for a code/i)).toBeDefined();
  });

  it('does not render when closed', () => {
    renderWith(false);
    expect(screen.queryByText(/I have my PIN/i)).toBeNull();
  });

  it('PIN path success writes identity to localStorage', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deleteToken: 'new-token-abc' }),
    });
    const onClose = vi.fn();
    renderWith(true, onClose);

    const nameInput = screen.getAllByLabelText(/name/i)[0];
    fireEvent.change(nameInput, { target: { value: 'Michael' } });
    const pinInput = screen.getAllByLabelText(/pin/i)[0];
    fireEvent.change(pinInput, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));

    await waitFor(() => {
      const stored = localStorage.getItem('badminton_identity');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!).token).toBe('new-token-abc');
    });
  });

  it('shows lockout banner on 429', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate_limited', retryAfter: 3600 }),
    });
    renderWith(true);
    fireEvent.change(screen.getAllByLabelText(/name/i)[0], { target: { value: 'X' } });
    fireEvent.change(screen.getAllByLabelText(/pin/i)[0], { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(screen.getByText(/too many tries/i)).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npx vitest run __tests__/components/RecoverySheet.test.tsx
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Add i18n keys**

Add to `messages/en.json` under a new `recovery` namespace:

```json
{
  "recovery": {
    "sheetTitle": "Restore my access",
    "pinPathTitle": "I have my PIN",
    "pinPathHelp": "Enter the 4-digit recovery PIN you set when signing up.",
    "codePathTitle": "Ask admin for a code",
    "codePathHelp": "Tell the admin you lost access. They'll give you a 6-digit code.",
    "nameLabel": "Your name",
    "pinLabel": "Recovery PIN",
    "codeLabel": "Recovery code",
    "submitPin": "Restore with PIN",
    "submitCode": "Restore with code",
    "errorInvalid": "That didn't match. Try again.",
    "errorRateLimited": "Too many tries. Try again later.",
    "welcomeBack": "Welcome back, {name}",
    "close": "Close"
  }
}
```

Add the same keys to `messages/zh-CN.json` with translations:

```json
{
  "recovery": {
    "sheetTitle": "恢复我的账号",
    "pinPathTitle": "我有 PIN 码",
    "pinPathHelp": "输入注册时设置的 4 位恢复 PIN 码。",
    "codePathTitle": "向管理员索取验证码",
    "codePathHelp": "告诉管理员你失去了访问权限,他们会给你一个 6 位验证码。",
    "nameLabel": "你的名字",
    "pinLabel": "恢复 PIN",
    "codeLabel": "恢复验证码",
    "submitPin": "用 PIN 码恢复",
    "submitCode": "用验证码恢复",
    "errorInvalid": "信息不匹配,请重试。",
    "errorRateLimited": "尝试次数过多,请稍后再试。",
    "welcomeBack": "欢迎回来,{name}",
    "close": "关闭"
  }
}
```

- [ ] **Step 4: Implement the sheet**

Create `components/RecoverySheet.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import BottomSheet from './BottomSheet';
import PinInput from './PinInput';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function RecoverySheet({ open, onClose, sessionId }: Props) {
  const t = useTranslations('recovery');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<'invalid' | 'rate_limited' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(kind: 'pin' | 'code') {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sessionId,
          ...(kind === 'pin' ? { pin } : { code }),
        }),
      });
      if (res.status === 429) {
        setError('rate_limited');
        return;
      }
      if (!res.ok) {
        setError('invalid');
        return;
      }
      const body = await res.json();
      setIdentity({ name: name.trim(), token: body.deleteToken, sessionId });
      setSuccess(name.trim());
      setTimeout(() => {
        onClose();
        setSuccess(null);
      }, 1500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('sheetTitle')}>
      <div style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {success ? (
          <p style={{ textAlign: 'center', fontSize: 18, color: 'var(--text-primary)' }}>
            {t('welcomeBack', { name: success })}
          </p>
        ) : (
          <>
            <section>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('pinPathTitle')}</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('pinPathHelp')}
              </p>
              <input
                type="text"
                aria-label={t('nameLabel')}
                placeholder={t('nameLabel')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: 12, borderRadius: 10, marginBottom: 10 }}
              />
              <PinInput value={pin} onChange={setPin} digits={4} label={t('pinLabel')} ariaInvalid={error === 'invalid'} />
              <button
                type="button"
                disabled={submitting || !name.trim() || pin.length !== 4}
                onClick={() => submit('pin')}
                className="btn-primary"
                style={{ marginTop: 12, width: '100%' }}
              >
                {t('submitPin')}
              </button>
            </section>

            <hr style={{ border: 'none', borderTop: '1px solid var(--glass-border)' }} />

            <section>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('codePathTitle')}</h3>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
                {t('codePathHelp')}
              </p>
              <PinInput value={code} onChange={setCode} digits={6} label={t('codeLabel')} ariaInvalid={error === 'invalid'} />
              <button
                type="button"
                disabled={submitting || !name.trim() || code.length !== 6}
                onClick={() => submit('code')}
                className="btn-primary"
                style={{ marginTop: 12, width: '100%' }}
              >
                {t('submitCode')}
              </button>
            </section>

            {error === 'invalid' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>{t('errorInvalid')}</p>
            )}
            {error === 'rate_limited' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorRateLimited')}</p>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
npx vitest run __tests__/components/RecoverySheet.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/RecoverySheet.tsx __tests__/components/RecoverySheet.test.tsx messages/en.json messages/zh-CN.json
git commit -m "feat(a2): RecoverySheet (PIN + code paths) + i18n keys"
```

---

### Task 11: `<ResetAccessSheet>` (admin-side)

**Files:**
- Create: `components/admin/ResetAccessSheet.tsx`

- [ ] **Step 1: Implement**

Create `components/admin/ResetAccessSheet.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import BottomSheet from '../BottomSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  playerName: string;
  code: string;
  expiresAt: number;
}

export default function ResetAccessSheet({ open, onClose, playerName, code, expiresAt }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const remainingSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = Math.floor(remainingSec / 60).toString().padStart(2, '0');
  const ss = (remainingSec % 60).toString().padStart(2, '0');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // best-effort; silent.
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={`Recovery code for ${playerName}`}>
      <div style={{ padding: '0 20px 24px', textAlign: 'center' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 36,
            letterSpacing: '0.3em',
            margin: '24px 0 16px',
          }}
          aria-live="polite"
        >
          {code}
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Expires in {mm}:{ss}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={copy} className="btn-ghost" style={{ flex: 1 }}>Copy</button>
          <button type="button" onClick={onClose} className="btn-primary" style={{ flex: 1 }}>Done</button>
        </div>
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ResetAccessSheet.tsx
git commit -m "feat(a2): ResetAccessSheet for admin-issued 6-digit codes"
```

---

### Task 12: "Reset access" button in `AdminDashboard`

**Files:**
- Modify: `components/admin/AdminDashboard.tsx`

- [ ] **Step 1: Find the active player row render block**

Read `components/admin/AdminDashboard.tsx` to locate where active (non-removed, non-waitlisted) players are rendered with their per-row buttons. The existing remove button uses `pm.handleRemove(player)` style; the restore section is around line 420 (per Task 4 codebase scan).

- [ ] **Step 2: Add state + handler at the top of the component**

```tsx
import { useState } from 'react';
import { isFlagOn } from '@/lib/flags';
import ResetAccessSheet from './ResetAccessSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// Inside the component:
const [resetSheet, setResetSheet] = useState<{
  open: boolean; playerName: string; code: string; expiresAt: number;
}>({ open: false, playerName: '', code: '', expiresAt: 0 });

async function handleResetAccess(player: { id: string; name: string }) {
  if (!confirm(`Generate a recovery code for ${player.name}?\n\nThey'll be able to use it to restore their access on a new device. The code expires in 15 minutes.`)) return;
  const res = await fetch(`${BASE}/api/players/reset-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId: player.id }),
  });
  if (!res.ok) {
    alert(`Failed to generate code (${res.status})`);
    return;
  }
  const body = await res.json();
  setResetSheet({ open: true, playerName: player.name, code: body.code, expiresAt: body.expiresAt });
}
```

- [ ] **Step 3: Add the button in the active-player row**

In the active player row render (alongside any existing per-row admin buttons), add (gated on the flag):

```tsx
{isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY') && !player.removed && !player.waitlisted && (
  <button
    type="button"
    onClick={() => handleResetAccess(player)}
    className="btn-ghost"
    title={`Reset access for ${player.name}`}
    style={{ fontSize: 12 }}
  >
    <span className="material-icons icon-sm" aria-hidden="true">key</span>
    <span className="hidden sm:inline">Reset access</span>
  </button>
)}
```

(Add `key` glyph to the Material Symbols subset URL in `app/layout.tsx` `icon_names=` param if not already present — the URL is in the `<link>` tag for fonts.googleapis.com.)

- [ ] **Step 4: Render the sheet at the bottom of the component**

Just before the closing `</>`/wrapper of AdminDashboard, render:

```tsx
<ResetAccessSheet
  open={resetSheet.open}
  onClose={() => setResetSheet((r) => ({ ...r, open: false }))}
  playerName={resetSheet.playerName}
  code={resetSheet.code}
  expiresAt={resetSheet.expiresAt}
/>
```

- [ ] **Step 5: Manual smoke check**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npm run dev
```

Open the admin tab, find an active player, click Reset access, confirm dialog, verify a 6-digit code appears in the sheet and counts down.

- [ ] **Step 6: Commit**

```bash
git add components/admin/AdminDashboard.tsx app/layout.tsx
git commit -m "feat(a2): admin Reset access button + ResetAccessSheet integration"
```

---

### Task 13: `<ProfileTab>` component

**Files:**
- Create: `components/ProfileTab.tsx`
- Test: `__tests__/components/ProfileTab.test.tsx`

- [ ] **Step 1: Add i18n keys**

Add to `messages/en.json` under new `profile` and `pin` namespaces, plus `nav.profile`:

```json
{
  "nav": {
    "profile": "Profile"
  },
  "profile": {
    "anonymousTitle": "Set up your profile",
    "anonymousBody": "You're not signed up yet. Head to Sign-Ups to join a session.",
    "anonymousRestoreLink": "Already a player but lost your access?",
    "playerName": "Name",
    "playerSession": "Signed up for",
    "pinSectionTitle": "Recovery PIN",
    "pinNotSet": "Not set",
    "pinIsSet": "Set",
    "pinSetButton": "Set PIN",
    "pinChangeButton": "Change",
    "pinRemoveButton": "Remove",
    "pinSaved": "Saved",
    "pinTooCommon": "Pick a less common PIN",
    "pinInvalid": "PIN must be 4 digits",
    "adminToolsTitle": "Admin tools",
    "adminToolsButton": "Admin tools →"
  },
  "pin": {
    "newLabel": "New PIN",
    "confirmLabel": "Confirm PIN",
    "save": "Save",
    "cancel": "Cancel",
    "mismatch": "PINs don't match"
  }
}
```

Add the same keys to `messages/zh-CN.json` with translations:

```json
{
  "nav": {
    "profile": "档案"
  },
  "profile": {
    "anonymousTitle": "设置你的档案",
    "anonymousBody": "你还没注册。去「报名」页面加入一场。",
    "anonymousRestoreLink": "已经是球员但失去了访问权限?",
    "playerName": "名字",
    "playerSession": "已报名场次",
    "pinSectionTitle": "恢复 PIN 码",
    "pinNotSet": "未设置",
    "pinIsSet": "已设置",
    "pinSetButton": "设置 PIN",
    "pinChangeButton": "更改",
    "pinRemoveButton": "移除",
    "pinSaved": "已保存",
    "pinTooCommon": "请选择不那么常见的 PIN",
    "pinInvalid": "PIN 必须是 4 位数字",
    "adminToolsTitle": "管理员工具",
    "adminToolsButton": "管理员工具 →"
  },
  "pin": {
    "newLabel": "新 PIN",
    "confirmLabel": "确认 PIN",
    "save": "保存",
    "cancel": "取消",
    "mismatch": "PIN 不匹配"
  }
}
```

- [ ] **Step 2: Write failing component tests**

Create `__tests__/components/ProfileTab.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import enMessages from '../../messages/en.json';

const renderWith = (props: Partial<React.ComponentProps<typeof ProfileTab>> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProfileTab
        sessionId="session-2026-04-27"
        sessionLabel="Apr 27"
        isAdmin={false}
        onAdminTools={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );

describe('ProfileTab', () => {
  beforeEach(() => {
    localStorage.clear();
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });
  afterEach(() => cleanup());

  it('shows anonymous empty state when no identity', () => {
    renderWith();
    expect(screen.getByText(/Set up your profile/i)).toBeDefined();
    expect(screen.getByText(/lost your access/i)).toBeDefined();
  });

  it('shows player profile + PIN row when identity exists', () => {
    localStorage.setItem('badminton_identity', JSON.stringify({
      name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27',
    }));
    renderWith();
    expect(screen.getByText('Michael')).toBeDefined();
    expect(screen.getByText(/Recovery PIN/i)).toBeDefined();
  });

  it('shows admin tools button only when isAdmin', () => {
    renderWith({ isAdmin: false });
    expect(screen.queryByText(/Admin tools/i)).toBeNull();
    cleanup();
    renderWith({ isAdmin: true });
    expect(screen.getByText(/Admin tools/i)).toBeDefined();
  });

  it('hides PIN affordances when flag is off', () => {
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    localStorage.setItem('badminton_identity', JSON.stringify({
      name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27',
    }));
    renderWith();
    expect(screen.queryByText(/Recovery PIN/i)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/components/ProfileTab.test.tsx
```

Expected: FAIL.

- [ ] **Step 4: Implement the component**

Create `components/ProfileTab.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isFlagOn } from '@/lib/flags';
import { getIdentity, clearIdentity, type Identity } from '@/lib/identity';
import RecoverySheet from './RecoverySheet';
import PinInput from './PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  sessionId: string;
  sessionLabel: string;
  isAdmin: boolean;
  onAdminTools: () => void;
}

export default function ProfileTab({ sessionId, sessionLabel, isAdmin, onAdminTools }: Props) {
  const t = useTranslations('profile');
  const tPin = useTranslations('pin');
  const [identity, setLocalIdentity] = useState<Identity | null>(null);
  const [pinIsSet, setPinIsSet] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [editingPin, setEditingPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSaved, setPinSaved] = useState(false);

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    if (id) {
      // Probe pinHash presence indirectly — fetch the player record and check
      // a `hasPin` flag in the server response (see Task 14: optionally extend
      // GET to include this). For now, treat localStorage pinSet hint as the
      // source of truth.
      const hint = localStorage.getItem('badminton_pin_set');
      setPinIsSet(hint === 'true');
    }
  }, []);

  async function savePin(value: string | null) {
    if (!identity) return;
    setPinError(null);
    // PATCH route requires player.id from body. Fetch the active player list
    // and find ourselves by case-insensitive name + sessionId match.
    const meRes = await fetch(`${BASE}/api/players`, { cache: 'no-store' });
    const players = (await meRes.json()) as { id: string; name: string; sessionId: string }[];
    const me = players.find(
      (p) => p.name.toLowerCase() === identity.name.toLowerCase() && p.sessionId === identity.sessionId,
    );
    if (!me) {
      setPinError('invalid');
      return;
    }
    const patchRes = await fetch(`${BASE}/api/players`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, pin: value, deleteToken: identity.token }),
    });
    if (!patchRes.ok) {
      const body = await patchRes.json().catch(() => ({}));
      setPinError(body.error === 'pin_too_common' ? 'too_common' : 'invalid');
      return;
    }
    setPinIsSet(value !== null);
    localStorage.setItem('badminton_pin_set', value !== null ? 'true' : 'false');
    setPinSaved(true);
    setEditingPin(false);
    setNewPin('');
    setConfirmPin('');
    setTimeout(() => setPinSaved(false), 2000);
  }

  // Anonymous state
  if (!identity) {
    return (
      <div className="animate-fadeIn" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 30, fontWeight: 600 }}>{t('anonymousTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
        {isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY') && (
          <>
            <p>
              <button
                type="button"
                onClick={() => setRecoveryOpen(true)}
                className="btn-ghost"
              >
                {t('anonymousRestoreLink')}
              </button>
            </p>
            <RecoverySheet open={recoveryOpen} onClose={() => setRecoveryOpen(false)} sessionId={sessionId} />
          </>
        )}
        {isAdmin && (
          <div className="glass-card p-5">
            <button type="button" onClick={onAdminTools} className="btn-primary" style={{ width: '100%' }}>
              {t('adminToolsButton')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Player (and possibly admin) state
  return (
    <div className="animate-fadeIn" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('playerName')}</p>
        <p style={{ fontSize: 24, fontWeight: 600 }}>{identity.name}</p>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('playerSession')} {sessionLabel}
        </p>
      </div>

      {isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY') && (
        <div className="glass-card p-5">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('pinSectionTitle')}</h3>
          {!editingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                {pinIsSet ? t('pinIsSet') : t('pinNotSet')}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setEditingPin(true)} className="btn-ghost">
                  {pinIsSet ? t('pinChangeButton') : t('pinSetButton')}
                </button>
                {pinIsSet && (
                  <button type="button" onClick={() => savePin(null)} className="btn-ghost">
                    {t('pinRemoveButton')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <PinInput value={newPin} onChange={setNewPin} digits={4} label={tPin('newLabel')} autoFocus />
              <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={tPin('confirmLabel')} />
              {pinError === 'too_common' && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('pinTooCommon')}</p>
              )}
              {pinError === 'invalid' && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('pinInvalid')}</p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={newPin.length !== 4 || newPin !== confirmPin}
                  onClick={() => savePin(newPin)}
                  style={{ flex: 1 }}
                >
                  {tPin('save')}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => { setEditingPin(false); setNewPin(''); setConfirmPin(''); setPinError(null); }}
                  style={{ flex: 1 }}
                >
                  {tPin('cancel')}
                </button>
              </div>
              {newPin && confirmPin && newPin !== confirmPin && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{tPin('mismatch')}</p>
              )}
            </div>
          )}
          {pinSaved && (
            <p style={{ fontSize: 12, color: 'var(--color-green, #10b981)', marginTop: 8 }}>{t('pinSaved')}</p>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="glass-card p-5">
          <button type="button" onClick={onAdminTools} className="btn-primary" style={{ width: '100%' }}>
            {t('adminToolsButton')}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npx vitest run __tests__/components/ProfileTab.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/ProfileTab.tsx __tests__/components/ProfileTab.test.tsx messages/en.json messages/zh-CN.json
git commit -m "feat(a2): ProfileTab with state-driven layout + PIN management"
```

---

### Task 14: PIN checkbox in HomeTab sign-up form

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Add state + UI inside the sign-up form**

In `components/HomeTab.tsx`, add to the component's state:

```tsx
const [signupPin, setSignupPin] = useState('');
const [pinOptIn, setPinOptIn] = useState(false);
```

In the `handleSignUp` function (and `handleJoinWaitlist`), include the PIN in the POST body:

```tsx
body: JSON.stringify({
  name: name.trim(),
  ...(pinOptIn && signupPin && isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY') ? { pin: signupPin } : {}),
}),
```

After successful signup (in the existing success handler), if a PIN was set, write the hint to localStorage:

```tsx
if (pinOptIn && signupPin) localStorage.setItem('badminton_pin_set', 'true');
```

In the form JSX (under the existing name input, around line 480 in the open state-4 render block, and the equivalent waitlist render around line 425), insert:

```tsx
{isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY') && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input
        id="signup-pin-optin"
        name="pinOptIn"
        type="checkbox"
        checked={pinOptIn}
        onChange={(e) => setPinOptIn(e.target.checked)}
      />
      {t('signup.setPinLabel')}
    </label>
    {pinOptIn && (
      <PinInput value={signupPin} onChange={setSignupPin} digits={4} label={t('signup.pinLabel')} />
    )}
  </div>
)}
```

Add imports at the top:

```tsx
import PinInput from './PinInput';
import { isFlagOn } from '@/lib/flags';
```

Add i18n keys to `messages/en.json` and `messages/zh-CN.json` under `signup`:

```json
{
  "signup": {
    "setPinLabel": "Set a recovery PIN (optional)",
    "pinLabel": "Recovery PIN"
  }
}
```

zh-CN:

```json
{
  "signup": {
    "setPinLabel": "设置恢复 PIN(可选)",
    "pinLabel": "恢复 PIN"
  }
}
```

- [ ] **Step 2: Manual smoke test**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npm run dev
```

Open Sign-Up form, check the PIN box, type 4 digits, sign up, verify success and that `localStorage.badminton_pin_set === 'true'`.

- [ ] **Step 3: Commit**

```bash
git add components/HomeTab.tsx messages/en.json messages/zh-CN.json
git commit -m "feat(a2): opt-in PIN checkbox on HomeTab sign-up form"
```

---

### Task 15: Update BottomNav (Profile in, Admin out of bar)

**Files:**
- Modify: `components/BottomNav.tsx:24-33`

- [ ] **Step 1: Update the tab list**

In `components/BottomNav.tsx:24-33`, change the `tabs` array and the `visibleTabs` filter:

```tsx
const tabs: NavItem[] = [
  { id: 'home',    label: t('home'),    icon: 'home' },
  { id: 'players', label: t('signups'), icon: 'group' },
  { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
  { id: 'profile', label: t('profile'), icon: 'person' },
];
const visibleTabs = isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY')
  ? tabs
  : tabs.filter((tab) => tab.id !== 'profile');
```

Add the import at the top:

```tsx
import { isFlagOn } from '@/lib/flags';
```

The `showAdmin` prop is no longer needed for the bar (Admin is reachable via Profile). For backwards-compat, keep it accepted but ignored — or remove it. The `Tab` type in `app/page.tsx` keeps `'admin'` as a valid value because `?tab=admin` deep links + ProfileTab → Admin still set `activeTab` to `'admin'`.

- [ ] **Step 2: Add `person` glyph to Material Symbols subset**

In `app/layout.tsx`, find the `<link>` to fonts.googleapis.com with `icon_names=` query string. Add `person` to the comma-separated list if not already present.

- [ ] **Step 3: Update existing nav tests**

Find any nav-related tests under `__tests__/` (e.g., `__tests__/nav.test.tsx` or similar from the design-preview work) and update assertions to expect Profile in the visible tabs when the flag is on.

- [ ] **Step 4: Commit**

```bash
git add components/BottomNav.tsx app/layout.tsx __tests__/
git commit -m "feat(a2): BottomNav adds Profile (flag-gated), Admin moves out of bar"
```

---

### Task 16: Wire ProfileTab into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Extend the Tab type and routing**

In `app/page.tsx`, find the `Tab` type and add `'profile'`:

```tsx
export type Tab = 'home' | 'players' | 'skills' | 'admin' | 'profile';
```

Where the active tab is rendered (the conditional block that picks between HomeTab/PlayersTab/etc.), add the ProfileTab branch:

```tsx
import ProfileTab from '@/components/ProfileTab';

// inside render:
{activeTab === 'profile' && (
  <ProfileTab
    sessionId={session?.id ?? ''}
    sessionLabel={session?.datetime ? format.dateTime(new Date(session.datetime), DAY_LONG) : ''}
    isAdmin={isAdmin}
    onAdminTools={() => setActiveTab('admin')}
  />
)}
```

(Use whatever variable names the file already uses for `session`, `isAdmin`, `format`, `setActiveTab`.)

- [ ] **Step 2: Preserve `?tab=admin` deep link**

Find the `useEffect` that reads `?tab=` from `window.location.search` (or similar — it exists for the existing tab system). Confirm `'admin'` is still accepted as a valid value. No change needed if it already accepts any string and falls back; verify with a brief manual test.

- [ ] **Step 3: Manual smoke test**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npm run dev
```

- Tap Profile tab in BottomNav → ProfileTab renders.
- As admin: tap "Admin tools →" → Admin tab renders.
- Visit `/bpm?tab=admin` directly → Admin tab renders.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(a2): wire ProfileTab into page.tsx + Admin tools navigation"
```

---

## Phase 4 — Docs + final verification

### Task 17: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "4 tabs" gotcha**

Find the line about "4 tabs: Home, Sign-Ups, **Stats**, Admin" and update:

```
**4 tabs (recovery flag off): Home, Sign-Ups, Stats, Admin.**
**4 tabs (recovery flag on): Home, Sign-Ups, Stats, Profile.** Admin still exists in the activeTab state machine and is reachable via Profile → "Admin tools →" or `?tab=admin` deep link.
```

- [ ] **Step 2: Add a new gotcha section for A2**

Append under the existing Gotchas list:

```
- **A2 identity recovery (flag-gated)**: when `NEXT_PUBLIC_FLAG_RECOVERY` is on, players can opt-in to a 4-digit PIN at sign-up (HomeTab checkbox) and self-recover via Profile → Restore. Lost-device recovery uses an admin-issued 6-digit code (15-min TTL, in-memory `lib/recoveryCodes.ts`). PINs are scrypt-hashed via `lib/recoveryHash.ts`; never returned in any GET/PATCH response (canary test asserts this). Admin's "Reset access" button on each active player row issues codes. Recovery endpoint at `POST /api/players/recover` is constant-time (dummy scrypt against `FAKE_HASH` for non-existent names) and rate-limited at 5/hr per `(name, IP)`. The flag, when off, returns 404 from `/recover` and `/reset-access`, and `pin` fields on POST/PATCH are silently ignored.
- **`pinHash` is a strip-canary**: like `deleteToken`, it must be removed from every GET/PATCH player response. The strip pattern in `app/api/players/route.ts` destructures both fields. New endpoints that return player records must mirror this.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(a2): update CLAUDE.md gotchas for recovery flow"
```

---

### Task 18: Run the full test suite + manual smoke

- [ ] **Step 1: Full vitest run**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npm test
```

Expected: all tests pass. Test count goes from 316 → ~340+.

- [ ] **Step 2: Run with flag off**

```bash
unset NEXT_PUBLIC_FLAG_RECOVERY
npm test
```

Expected: still all pass. Flag-off branches must work too.

- [ ] **Step 3: Manual smoke checklist on dev server**

```bash
NEXT_PUBLIC_FLAG_RECOVERY=true npm run dev
```

In a browser:

1. Sign up as a new player with the PIN checkbox checked → success.
2. Clear localStorage. Open Profile tab → "Set up your profile" anonymous state with "Restore" link.
3. Tap Restore link → RecoverySheet opens with both PIN and code paths.
4. Type name + correct PIN → success → identity restored, can self-cancel.
5. Clear localStorage. Try wrong PIN 5 times → 429 banner with retry-after.
6. Wait for the rate-limit window (or restart the dev server to clear it). Admin issues a code via Admin tab → Reset access button. Read the 6-digit code aloud.
7. Type name + code → success.
8. Verify the old `deleteToken` no longer self-cancels (already covered by unit test).
9. Set `NEXT_PUBLIC_FLAG_RECOVERY=false`, restart dev server. Confirm:
   - Profile tab is hidden in BottomNav.
   - `/api/players/recover` returns 404.
   - `/api/players/reset-access` returns 404.
   - Admin "Reset access" button is hidden.
   - HomeTab sign-up has no PIN checkbox.

- [ ] **Step 4: Final commit**

If you made any small fixes during smoke, commit them. Otherwise no-op.

```bash
git status
```

If clean: implementation is done. Time to push and open PR.

```bash
git push -u origin <branch-name>
gh pr create --title "feat(a2): identity recovery bridge — opt-in PIN + admin code" \
  --body "Implements docs/superpowers/specs/2026-04-26-a2-identity-recovery-design.md per docs/superpowers/plans/2026-04-27-a2-identity-recovery.md. Flag-gated behind NEXT_PUBLIC_FLAG_RECOVERY (off on stable, on for next + dev)."
```

(Reminder: the user's no-commit-without-triple-confirm rule applies. Do NOT push or open a PR until the user types `xyzou2012@gmail.com` three times in their own messages this conversation.)

---

## Self-review checklist (run after writing — do not skip)

- [x] **Spec coverage:** Threat model A+C+E covered (PIN + admin code + constant-time + rate limit). Hybrid PIN/admin path implemented. Per-row Reset access UX implemented. Profile-as-tab nav restructure implemented (Option Y). Audit log capped at 200. Constant-time miss + rate-limit-bucket-for-fake-names implemented. Soft PIN blocklist of 5 implemented. Flag-off returns 404 on endpoints. All locked decisions present.
- [x] **No placeholders:** Every code step has concrete TS. No "TBD" or "implement appropriate validation."
- [x] **Type consistency:** `RecoveryEvent` defined in Task 1 and used identically in Tasks 4, 5, 6, 7, 8. `hashPin` / `verifyPin` / `FAKE_HASH` defined in Task 2 and used in Tasks 5, 6, 7, 8. `issueCode` / `consumeCode` / `invalidateCode` defined in Task 3 and used in Task 5, 6.
- [x] **Granularity:** each task has TDD steps + commit. Each step is one concrete action.

---

## Out of scope (intentional, do not creep)

- Email/SMS OTP, SSO, OAuth.
- CAPTCHA on the recovery endpoint.
- Migrating Admin UI into ProfileTab (stays as a separate tab reachable via deep link).
- Issue #29 (signupOpen on finished sessions) — separate bug, separate PR.
- E2E / Playwright tests.
