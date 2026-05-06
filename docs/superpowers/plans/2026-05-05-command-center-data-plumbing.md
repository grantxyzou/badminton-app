# Command Center — Plan 1: Data Plumbing & memberId Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land all schema additions for the Admin Command Center, close the admin-bypass gap in `memberId` writes, and backfill `memberId` on legacy player records — all with **zero user-visible UI change**.

**Architecture:** Additive-only schema changes (preserves bpm-stable / bpm-next co-existence). Three new optional fields on `Session`, two on `Member`. Existing `Player.memberId` field stays as-is; admin signup path is patched to auto-create a member record when none exists; a backfill script links every legacy player to its member. Plans 2 and 3 build on this clean foundation.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Cosmos DB / mock store, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-05-admin-command-center-design.md`

---

## File map

| File | Action | Purpose |
|---|---|---|
| `lib/types.ts` | Modify | Add `Session.prevSnapshot`, `Session.anomaliesAtAdvance`, `Session.anomaliesDismissed`, `Session.eTransferRecipient`, `Member.eTransferRecipient`, `Member.skipDates`, define `PrevSessionSnapshot` and `ETransferRecipient` |
| `app/api/session/advance/route.ts` | Modify | Write `prevSnapshot` and `anomaliesAtAdvance` at advance time |
| `app/api/session/route.ts` | Modify | Extend `PUT` to accept `eTransferRecipient`, `anomaliesDismissed` |
| `app/api/admin/settings/route.ts` | Create | New admin-only `PATCH` for `skipDates` and `eTransferRecipient` on the admin's own `members` doc |
| `app/api/players/route.ts` | Modify | Auto-create a `members` doc when admin signs up someone without an existing member |
| `app/api/admin/migrate-memberId/route.ts` | Create | Admin-only POST that runs the backfill server-side (logic + tests live here) |
| `scripts/migrate-memberId.mjs` | Create | Thin CLI wrapper that POSTs to the admin route (mirrors `scripts/backfill-attendance.mjs`) |
| `__tests__/session-advance-snapshot.test.ts` | Create | Verifies advance writes `prevSnapshot` + `anomaliesAtAdvance` correctly |
| `__tests__/session-etransfer-and-anomalies.test.ts` | Create | Verifies PUT accepts new fields, validates shape |
| `__tests__/admin-settings.test.ts` | Create | Tests new `/api/admin/settings` PATCH |
| `__tests__/players-admin-creates-member.test.ts` | Create | Verifies admin signup now creates a member when none exists |
| `__tests__/migrate-memberId.test.ts` | Create | Tests the migration route: links, idempotency, collision halt, dry-run, auth |

---

## Task 1: Extend type definitions

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add the new types**

Open `lib/types.ts` and add **above** the `Session` interface:

```typescript
export interface PrevSessionSnapshot {
  courtCount: number;
  costPerCourt: number;
  maxPlayers: number;
  /** Hours between session start and the deadline at the time of advance. */
  deadlineOffsetHours: number;
  /** Hours before session start that signup-open was set (if recorded). 0 if signup was opened immediately. */
  signupOpensOffsetHours: number;
}

export interface ETransferRecipient {
  name: string;
  email: string;
  /** Optional default memo template — supports `{date}` and `{name}` placeholders. */
  memo?: string;
}
```

- [ ] **Step 2: Extend the `Session` interface**

Add these fields to the existing `Session` interface (alongside existing optional fields):

```typescript
/** Frozen snapshot of the previous session's settings, written at advance time. */
prevSnapshot?: PrevSessionSnapshot;
/** Anomaly codes detected at the moment of advance (e.g. 'cost_changed'). Frozen. */
anomaliesAtAdvance?: string[];
/** Anomaly codes the admin dismissed for this session (live, mutable). */
anomaliesDismissed?: string[];
/** Per-session override of the e-transfer recipient. Falls back to the admin member's setting if absent. */
eTransferRecipient?: ETransferRecipient;
```

- [ ] **Step 3: Extend the `Member` interface**

Add these fields to the existing `Member` interface:

```typescript
/** Admin-only: organizer's default e-transfer recipient, used by the receipt export. */
eTransferRecipient?: ETransferRecipient;
/** Admin-only: dates (YYYY-MM-DD) the admin has marked as skipped. Used by the skip_date anomaly. */
skipDates?: string[];
```

- [ ] **Step 4: Run typecheck to verify nothing breaks**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If anything fails, fix the affected file inline (likely a missing field that was previously inferred).

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts
git commit -m "$(cat <<'EOF'
types: add command-center schema fields (additive, no logic)

Adds PrevSessionSnapshot, ETransferRecipient. Extends Session with
prevSnapshot/anomaliesAtAdvance/anomaliesDismissed/eTransferRecipient,
and Member with eTransferRecipient/skipDates. All optional — existing
docs continue to read normally.
EOF
)"
```

---

## Task 2: Advance route writes `prevSnapshot` + `anomaliesAtAdvance`

**Files:**
- Test: `__tests__/session-advance-snapshot.test.ts`
- Modify: `app/api/session/advance/route.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/session-advance-snapshot.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
  getStore,
} from './helpers';
import { POST as ADVANCE } from '@/app/api/session/advance/route';

setupAdminPin();

describe('POST /api/session/advance — snapshot fields', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('writes prevSnapshot from current session settings', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', {
      courts: 3,
      costPerCourt: 35,
      maxPlayers: 14,
      deadline: '2026-04-29T18:00:00-04:00',
      datetime: '2026-04-29T20:00:00-04:00',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 3,
      maxPlayers: 14,
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.prevSnapshot).toBeDefined();
    expect(body.prevSnapshot.courtCount).toBe(3);
    expect(body.prevSnapshot.costPerCourt).toBe(35);
    expect(body.prevSnapshot.maxPlayers).toBe(14);
    expect(body.prevSnapshot.deadlineOffsetHours).toBe(2);
    expect(Array.isArray(body.anomaliesAtAdvance)).toBe(true);
  });

  it('flags cost_changed in anomaliesAtAdvance when costPerCourt differs', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 32, maxPlayers: 12 });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      costPerCourt: 40, // changed
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    const body = await res.json();
    expect(body.anomaliesAtAdvance).toContain('cost_changed');
  });

  it('flags long_break in anomaliesAtAdvance when gap > 21 days', async () => {
    seedPointer('session-2026-04-01');
    seedSession('session-2026-04-01', {
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
      datetime: '2026-04-01T20:00:00-04:00',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-29T20:00:00-04:00', // 28 days later
      deadline: '2026-04-29T18:00:00-04:00',
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    const body = await res.json();
    expect(body.anomaliesAtAdvance).toContain('long_break');
  });

  it('omits prevSnapshot if there is no current session', async () => {
    // No seedPointer → no current session
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prevSnapshot).toBeUndefined();
    expect(body.anomaliesAtAdvance).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/session-advance-snapshot.test.ts
```

Expected: FAIL — `prevSnapshot` undefined, `anomaliesAtAdvance` undefined.

- [ ] **Step 3: Modify `app/api/session/advance/route.ts`**

Replace the `newSession` construction block. Find the section that builds `newSession` and replace it with:

```typescript
    // Build prevSnapshot from current session if present
    let prevSnapshot: import('@/lib/types').PrevSessionSnapshot | undefined;
    const anomaliesAtAdvance: string[] = [];

    if (currentSession) {
      const courtCount = Number(currentSession.courts ?? 0);
      const costPerCourt = Number(currentSession.costPerCourt ?? 0);
      const maxPlayers = Number(currentSession.maxPlayers ?? 0);
      const prevDeadlineMs = currentSession.deadline ? new Date(currentSession.deadline).getTime() : NaN;
      const prevStartMs = currentSession.datetime ? new Date(currentSession.datetime).getTime() : NaN;
      const deadlineOffsetHours = Number.isFinite(prevDeadlineMs) && Number.isFinite(prevStartMs)
        ? Math.max(0, Math.round((prevStartMs - prevDeadlineMs) / 3_600_000))
        : 0;

      prevSnapshot = {
        courtCount,
        costPerCourt,
        maxPlayers,
        deadlineOffsetHours,
        signupOpensOffsetHours: 0, // not yet recorded; reserved for the schedule rule (Plan 2+)
      };

      // Anomaly: cost_changed
      const newCost = typeof body.costPerCourt === 'number' ? body.costPerCourt : costPerCourt;
      if (costPerCourt !== newCost) anomaliesAtAdvance.push('cost_changed');

      // Anomaly: courts_changed
      const newCourts = Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2));
      if (courtCount !== newCourts) anomaliesAtAdvance.push('courts_changed');

      // Anomaly: max_players_changed
      const newMax = Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12));
      if (maxPlayers !== newMax) anomaliesAtAdvance.push('max_players_changed');

      // Anomaly: long_break (gap > 21 days between previous session start and new session start)
      if (Number.isFinite(prevStartMs)) {
        const newStartMs = new Date(datetime).getTime();
        if (Number.isFinite(newStartMs) && (newStartMs - prevStartMs) > 21 * 86_400_000) {
          anomaliesAtAdvance.push('long_break');
        }
      }
    }

    const newSession = {
      id: newId,
      sessionId: newId,
      title: String(body.title ?? '').trim().slice(0, 100) || 'Weekly Badminton Session',
      locationName: String(body.locationName ?? '').trim().slice(0, 200),
      locationAddress: String(body.locationAddress ?? '').trim().slice(0, 300),
      datetime,
      endDatetime: toValidIso(body.endDatetime),
      deadline: toValidIso(body.deadline),
      courts: Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12)),
      signupOpen: false,
      anomaliesAtAdvance,
      ...(typeof body.costPerCourt === 'number' ? { costPerCourt: Math.max(0, Math.min(500, body.costPerCourt)) } : {}),
      ...(prevSessionDate ? { prevSessionDate } : {}),
      ...(prevCostPerPerson ? { prevCostPerPerson } : {}),
      ...(prevSnapshot ? { prevSnapshot } : {}),
    };
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run __tests__/session-advance-snapshot.test.ts __tests__/session.test.ts
```

Expected: PASS for the new file, no regressions in `session.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/api/session/advance/route.ts __tests__/session-advance-snapshot.test.ts
git commit -m "$(cat <<'EOF'
feat(session): write prevSnapshot + anomaliesAtAdvance on advance

Freezes a snapshot of the previous session's settings (courts, cost,
maxPlayers, deadline offset) and a list of anomaly codes detected at
advance time. Powers the command-center anomaly feed in plan 2.
Existing prevSessionDate/prevCostPerPerson untouched (legacy readers).
EOF
)"
```

---

## Task 3: PUT `/api/session` accepts `eTransferRecipient` and `anomaliesDismissed`

**Files:**
- Test: `__tests__/session-etransfer-and-anomalies.test.ts`
- Modify: `app/api/session/route.ts`

- [ ] **Step 1: Read the existing PUT handler to identify the update block**

```bash
grep -n "PUT\|export async function" app/api/session/route.ts | head -20
```

Locate the PUT handler. Identify where validated fields are merged into the session document (look for the `updates` object construction or where individual `body.*` fields are read).

- [ ] **Step 2: Write the failing test**

Create `__tests__/session-etransfer-and-anomalies.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { PUT, GET } from '@/app/api/session/route';

setupAdminPin();

describe('PUT /api/session — eTransferRecipient + anomaliesDismissed', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer('session-2026-05-06');
    seedSession('session-2026-05-06', {
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
    });
  });

  it('admin can set eTransferRecipient with valid shape', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: {
        name: 'Grant Zou',
        email: 'xyzou2012@gmail.com',
        memo: 'BPM {date} - {name}',
      },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eTransferRecipient.email).toBe('xyzou2012@gmail.com');
  });

  it('rejects eTransferRecipient with missing email', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: { name: 'Grant Zou' }, // no email
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('admin can set anomaliesDismissed', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      anomaliesDismissed: ['settings_drift', 'long_break'],
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anomaliesDismissed).toEqual(['settings_drift', 'long_break']);
  });

  it('rejects anomaliesDismissed with non-string entries', async () => {
    const req = makeAdminRequest('PUT', 'http://localhost:3000/api/session', {
      anomaliesDismissed: ['settings_drift', 42],
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
  });

  it('non-admin cannot set eTransferRecipient', async () => {
    const req = makeRequest('PUT', 'http://localhost:3000/api/session', {
      eTransferRecipient: { name: 'X', email: 'x@x.com' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run __tests__/session-etransfer-and-anomalies.test.ts
```

Expected: FAIL — fields ignored or rejected by the existing handler.

- [ ] **Step 4: Add a validator helper at the top of `app/api/session/route.ts`**

After the existing imports, add:

```typescript
function isValidETransferRecipient(value: unknown): value is import('@/lib/types').ETransferRecipient {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; email?: unknown; memo?: unknown };
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return false;
  if (typeof v.email !== 'string' || !v.email.trim() || v.email.length > 200) return false;
  if (v.memo !== undefined && (typeof v.memo !== 'string' || v.memo.length > 200)) return false;
  return true;
}

function isValidAnomalyDismissedList(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length > 20) return false;
  return value.every((c) => typeof c === 'string' && c.length > 0 && c.length <= 50);
}
```

- [ ] **Step 5: Wire the new fields into the PUT handler**

Inside the PUT handler, **after** body parsing and admin auth check, add:

```typescript
    if (body.eTransferRecipient !== undefined && !isValidETransferRecipient(body.eTransferRecipient)) {
      return NextResponse.json({ error: 'Invalid eTransferRecipient' }, { status: 400 });
    }
    if (body.anomaliesDismissed !== undefined && !isValidAnomalyDismissedList(body.anomaliesDismissed)) {
      return NextResponse.json({ error: 'Invalid anomaliesDismissed' }, { status: 400 });
    }
```

Then in the merge block where the existing session is updated, add (alongside existing field merges):

```typescript
      ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
      ...(body.anomaliesDismissed !== undefined ? { anomaliesDismissed: body.anomaliesDismissed } : {}),
```

If the route uses an explicit "only these fields are accepted" allowlist, add `eTransferRecipient` and `anomaliesDismissed` to it.

- [ ] **Step 6: Run tests**

```bash
npx vitest run __tests__/session-etransfer-and-anomalies.test.ts __tests__/session.test.ts
```

Expected: PASS for the new file, no regressions.

- [ ] **Step 7: Commit**

```bash
git add app/api/session/route.ts __tests__/session-etransfer-and-anomalies.test.ts
git commit -m "$(cat <<'EOF'
feat(session): PUT accepts eTransferRecipient + anomaliesDismissed

Adds validated session-level overrides for receipt recipient and
admin-dismissed anomaly codes. Both admin-only, both optional —
unset sessions fall back to defaults defined in plan 2.
EOF
)"
```

---

## Task 4: New `PATCH /api/admin/settings` for `skipDates` + `eTransferRecipient` on the admin's member doc

**Files:**
- Create: `app/api/admin/settings/route.ts`
- Test: `__tests__/admin-settings.test.ts`

Why a new route: `PATCH /api/members/me` is PIN-authenticated and scoped to a name in the body — wrong shape for admin-only fields tied to the calling admin's identity. A separate route gated by the admin cookie keeps PIN flow and admin-settings flow cleanly separated.

- [ ] **Step 1: Write the failing test**

Create `__tests__/admin-settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { PATCH } from '@/app/api/admin/settings/route';

setupAdminPin();

describe('PATCH /api/admin/settings', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('admin can set skipDates', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20', '2026-12-25'],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipDates).toEqual(['2026-05-20', '2026-12-25']);

    const members = (getStore()['members'] as Array<{ id: string; skipDates?: string[] }>);
    const me = members.find((m) => m.id === 'member-test-admin');
    expect(me?.skipDates).toEqual(['2026-05-20', '2026-12-25']);
  });

  it('admin can set eTransferRecipient', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      eTransferRecipient: { name: 'Grant', email: 'g@example.com' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eTransferRecipient.email).toBe('g@example.com');
  });

  it('rejects malformed skipDates', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026/05/20'], // wrong format
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('rejects skipDates with too many entries', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: Array.from({ length: 200 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('does not strip pinHash from the stored member doc', async () => {
    const beforeMembers = (getStore()['members'] as Array<{ pinHash?: string }>);
    const beforePinHash = beforeMembers[0]?.pinHash;
    expect(beforePinHash).toBeDefined();

    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    await PATCH(req);

    const afterMembers = (getStore()['members'] as Array<{ pinHash?: string }>);
    expect(afterMembers[0]?.pinHash).toBe(beforePinHash);
  });

  it('strips pinHash from the response', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    const res = await PATCH(req);
    const body = await res.json();
    expect(body.pinHash).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/admin-settings.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route**

Create `app/api/admin/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, getAdminMemberId, unauthorized } from '@/lib/auth';

const SKIP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SKIP_DATES = 100;

function isValidETransferRecipient(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as { name?: unknown; email?: unknown; memo?: unknown };
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100) return false;
  if (typeof v.email !== 'string' || !v.email.trim() || v.email.length > 200) return false;
  if (v.memo !== undefined && (typeof v.memo !== 'string' || v.memo.length > 200)) return false;
  return true;
}

function isValidSkipDates(value: unknown): value is string[] {
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_SKIP_DATES) return false;
  return value.every((d) => typeof d === 'string' && SKIP_DATE_RE.test(d));
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  const memberId = getAdminMemberId(req);
  if (!memberId) return unauthorized();

  let body: { skipDates?: unknown; eTransferRecipient?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (body.skipDates !== undefined && !isValidSkipDates(body.skipDates)) {
    return NextResponse.json({ error: 'Invalid skipDates' }, { status: 400 });
  }
  if (body.eTransferRecipient !== undefined && !isValidETransferRecipient(body.eTransferRecipient)) {
    return NextResponse.json({ error: 'Invalid eTransferRecipient' }, { status: 400 });
  }

  try {
    const container = getContainer('members');
    const { resource: existing } = await container.item(memberId, memberId).read();
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const updated = {
      ...existing,
      ...(body.skipDates !== undefined ? { skipDates: body.skipDates } : {}),
      ...(body.eTransferRecipient !== undefined ? { eTransferRecipient: body.eTransferRecipient } : {}),
    };
    const { resource } = await container.items.upsert(updated);
    const safe = resource as Record<string, unknown>;
    const { pinHash: _ph, ...exposed } = safe;
    return NextResponse.json(exposed);
  } catch (error) {
    console.error('PATCH /api/admin/settings error:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Verify `getAdminMemberId` exists in `lib/auth.ts`**

```bash
grep -n "getAdminMemberId\|memberId" lib/auth.ts | head
```

If it doesn't exist, add it. Open `lib/auth.ts` and add (alongside `isAdminAuthed`):

```typescript
import type { NextRequest } from 'next/server';

/**
 * Extract the admin's memberId from the signed cookie. Returns null if
 * the cookie is missing or invalid. Pair with `isAdminAuthed` — this
 * function does NOT verify the signature; it just reads the payload.
 */
export function getAdminMemberId(req: NextRequest): string | null {
  if (!isAdminAuthed(req)) return null;
  const cookie = req.cookies.get('admin_session')?.value;
  if (!cookie) return null;
  const [headerB64] = cookie.split('.');
  if (!headerB64) return null;
  try {
    const json = Buffer.from(headerB64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { memberId?: unknown };
    return typeof payload.memberId === 'string' ? payload.memberId : null;
  } catch {
    return null;
  }
}
```

(If `lib/auth.ts` already exports a way to get the member ID under a different name, use it instead and adjust the route import. Verify with the grep above before writing.)

- [ ] **Step 5: Run tests**

```bash
npx vitest run __tests__/admin-settings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/settings/route.ts lib/auth.ts __tests__/admin-settings.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): PATCH /api/admin/settings for skipDates + eTransferRecipient

Admin-only endpoint for organizer-level command-center settings
(skip dates, default e-transfer recipient). Mutates the calling
admin's own members doc — auth via existing admin cookie.
EOF
)"
```

---

## Task 5: `POST /api/players` auto-creates a member when admin signs up someone without one

**Files:**
- Test: `__tests__/players-admin-creates-member.test.ts`
- Modify: `app/api/players/route.ts`

Today, when an admin signs up a name with no matching member, the player record is created **without** a `memberId`. This breaks the spec's invariant ("every player record links to a member"). Fix: in the admin-bypass branch, create a member if absent and link via `memberId`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/players-admin-creates-member.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
  getStore,
} from './helpers';
import { POST } from '@/app/api/players/route';

setupAdminPin();

describe('POST /api/players — admin creates member when missing', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer('session-2026-05-06');
    seedSession('session-2026-05-06');
  });

  it('admin signing up a brand-new name creates a member and links memberId', async () => {
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Brand New Player',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memberId).toBeDefined();

    const members = getStore()['members'] as Array<{ id: string; name: string }>;
    const created = members.find((m) => m.name === 'Brand New Player');
    expect(created).toBeDefined();
    expect(body.memberId).toBe(created!.id);
  });

  it('admin signing up an existing member name reuses that memberId', async () => {
    const members = getStore()['members'] as Array<{ id: string; name: string; sessionCount: number; active: boolean; createdAt: string; role: string }>;
    members.push({
      id: 'member-existing-daisy',
      name: 'Daisy',
      sessionCount: 5,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'member',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Daisy',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memberId).toBe('member-existing-daisy');

    const namedMembers = members.filter((m) => m.name === 'Daisy');
    expect(namedMembers.length).toBe(1); // no duplicate
  });

  it('non-admin signing up a name not in members is still rejected (invite-only)', async () => {
    // Wipe the seeded admin member so non-admin path has no matches
    const store = getStore();
    store['members'] = [];

    const req = (await import('./helpers')).makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Anonymous Stranger',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('invite_list_not_found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/players-admin-creates-member.test.ts
```

Expected: FAIL on the first test — `body.memberId` is undefined for admin-bypass new names.

- [ ] **Step 3: Modify `app/api/players/route.ts`**

Find the block (around line 168-175 in the current file):

```typescript
    if (allMembers.length > 0) {
      matchedMember = allMembers.find(
        (m: { name: string }) => m.name.toLowerCase() === trimmedName.toLowerCase()
      ) ?? null;
      if (!matchedMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
      }
    }
```

Replace with:

```typescript
    matchedMember = allMembers.find(
      (m: { name: string }) => m.name.toLowerCase() === trimmedName.toLowerCase()
    ) ?? null;

    if (!matchedMember && !isAdminAuthed(req)) {
      return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
    }

    // Admin-bypass auto-create: if the admin is signing up a name we've
    // never seen, create the members doc now so the player record can link
    // via memberId. Keeps the "every player has a member" invariant the
    // command center depends on.
    if (!matchedMember && isAdminAuthed(req)) {
      const newMember = {
        id: randomBytes(12).toString('hex'),
        name: trimmedName,
        role: 'member' as const,
        sessionCount: 0,
        active: true,
        createdAt: new Date().toISOString(),
      };
      const { resource } = await membersContainer.items.create(newMember);
      matchedMember = resource as typeof matchedMember;
    }
```

The outer `if (allMembers.length > 0)` guard is removed because the lookup is safe on an empty list (`.find` returns `undefined`).

- [ ] **Step 4: Run all player tests to verify no regressions**

```bash
npx vitest run __tests__/players.test.ts __tests__/players-admin-creates-member.test.ts __tests__/players-create-account.test.ts __tests__/players-recover.test.ts
```

Expected: PASS across all.

- [ ] **Step 5: Commit**

```bash
git add app/api/players/route.ts __tests__/players-admin-creates-member.test.ts
git commit -m "$(cat <<'EOF'
fix(players): admin signup auto-creates member when name not seen

Closes a write-path gap where admin-bypass signups produced player
records with no memberId (because no matching member existed).
Every player record now links to a member, restoring the invariant
the command-center history view depends on.
EOF
)"
```

---

## Task 6: `memberId` backfill — admin route + thin CLI wrapper

**Files:**
- Create: `app/api/admin/migrate-memberId/route.ts` (logic + auth)
- Create: `scripts/migrate-memberId.mjs` (CLI wrapper that POSTs to the route)
- Test: `__tests__/migrate-memberId.test.ts`

**Pattern:** Mirrors `scripts/backfill-attendance.mjs` + `app/api/admin/backfill-attendance/route.ts`. The route holds the migration logic, runs server-side with full Cosmos access, is testable via vitest, and is admin-gated. The CLI script is a 30-line wrapper that hits the route with an admin cookie.

- [ ] **Step 1: Write the failing test**

Create `__tests__/migrate-memberId.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { POST } from '@/app/api/admin/migrate-memberId/route';

setupAdminPin();

describe('POST /api/admin/migrate-memberId', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('links a player without memberId to an existing member by exact name', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 'session-2026-04-01', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.linked).toBe(1);
    expect(body.created).toBe(0);
    expect(body.collisions).toEqual([]);
    expect((store['players'][0] as { memberId?: string }).memberId).toBe('m1');
  });

  it('creates a member when one does not exist for the player name', async () => {
    const store = getStore();
    store['players'] = [{ id: 'p1', name: 'Newcomer', sessionId: 's1', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.linked).toBe(1);
    const created = (store['members'] as Array<{ name: string }>).find((m) => m.name === 'Newcomer');
    expect(created).toBeDefined();
    expect((store['players'][0] as { memberId?: string }).memberId).toBeDefined();
  });

  it('skips records that already have memberId', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x', memberId: 'm1' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.linked).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('halts on collision: two distinct members sharing a name', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push(
      { id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x' },
      { id: 'm2', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x' },
    );
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.collisions.length).toBe(1);
    expect(body.collisions[0]).toEqual({ name: 'Daisy', memberCount: 2 });
    expect((store['players'][0] as { memberId?: string }).memberId).toBeUndefined();
  });

  it('dry run makes no writes', async () => {
    const store = getStore();
    store['players'] = [{ id: 'p1', name: 'Newcomer', sessionId: 's1', timestamp: 'x' }];
    const memberCountBefore = (store['members'] as Array<unknown>).length;

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: true });
    const res = await POST(req);
    const body = await res.json();

    expect(body.linked).toBe(0);
    expect(body.wouldLink).toBe(1);
    expect(body.wouldCreate).toBe(1);
    expect((store['members'] as Array<unknown>).length).toBe(memberCountBefore);
    expect((store['players'][0] as { memberId?: string }).memberId).toBeUndefined();
  });

  it('is idempotent — second run is a no-op', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x' }];

    const req1 = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const r1 = await (await POST(req1)).json();
    expect(r1.linked).toBe(1);

    const req2 = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const r2 = await (await POST(req2)).json();
    expect(r2.linked).toBe(0);
    expect(r2.skipped).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/migrate-memberId.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the admin route**

Create `app/api/admin/migrate-memberId/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface MigrationSummary {
  linked: number;
  created: number;
  skipped: number;
  wouldLink: number;
  wouldCreate: number;
  collisions: Array<{ name: string; memberCount: number }>;
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dryRun === true;
  } catch {
    // empty body — proceed with defaults
  }

  try {
    const playersContainer = getContainer('players');
    const membersContainer = getContainer('members');

    const [{ resources: allPlayers }, { resources: allMembers }] = await Promise.all([
      playersContainer.items.query({ query: 'SELECT * FROM c' }).fetchAll(),
      membersContainer.items.query({ query: 'SELECT * FROM c' }).fetchAll(),
    ]);

    // Group members by lowercased name for collision detection.
    const membersByName = new Map<string, Array<Record<string, unknown>>>();
    for (const m of allMembers as Array<Record<string, unknown>>) {
      if (typeof m?.name !== 'string') continue;
      const key = (m.name as string).toLowerCase();
      const list = membersByName.get(key) ?? [];
      list.push(m);
      membersByName.set(key, list);
    }

    const summary: MigrationSummary = {
      linked: 0, created: 0, skipped: 0, wouldLink: 0, wouldCreate: 0, collisions: [],
    };

    for (const player of allPlayers as Array<Record<string, unknown>>) {
      if (typeof player?.name !== 'string') continue;
      if (typeof player.memberId === 'string' && (player.memberId as string).length > 0) {
        summary.skipped++;
        continue;
      }

      const key = (player.name as string).toLowerCase();
      const candidates = membersByName.get(key) ?? [];

      if (candidates.length > 1) {
        if (!summary.collisions.find((c) => c.name === player.name)) {
          summary.collisions.push({ name: player.name as string, memberCount: candidates.length });
        }
        continue;
      }

      let target = candidates[0];
      if (!target) {
        const newMember = {
          id: randomBytes(12).toString('hex'),
          name: player.name,
          role: 'member' as const,
          sessionCount: 0,
          active: true,
          createdAt: new Date().toISOString(),
        };
        if (dryRun) {
          summary.wouldCreate++;
        } else {
          const { resource } = await membersContainer.items.create(newMember);
          target = resource as Record<string, unknown>;
          membersByName.set(key, [target]);
          summary.created++;
        }
      }

      if (dryRun) {
        summary.wouldLink++;
      } else if (target) {
        await playersContainer.items.upsert({ ...player, memberId: target.id });
        summary.linked++;
      }
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('migrate-memberId error:', error);
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run __tests__/migrate-memberId.test.ts
```

Expected: PASS for all 7 cases.

- [ ] **Step 5: Create the CLI wrapper**

Create `scripts/migrate-memberId.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Backfill memberId on every players record by hitting the admin migration
 * endpoint. Idempotent. Halts on collisions.
 *
 * Usage:
 *   ADMIN_COOKIE='<value>' BASE_URL='https://bpm-next.azurewebsites.net' node scripts/migrate-memberId.mjs --dry-run
 *   ADMIN_COOKIE='<value>' BASE_URL='https://bpm-stable.azurewebsites.net' node scripts/migrate-memberId.mjs
 *
 * For local dev:
 *   BASE_URL='http://localhost:3000/bpm' ADMIN_COOKIE='<from devtools>' node scripts/migrate-memberId.mjs --dry-run
 *
 * Exit codes:
 *   0 — success
 *   1 — collisions detected (manual review required)
 *   2 — request or auth failure
 */

const dryRun = process.argv.includes('--dry-run');
const baseUrl = process.env.BASE_URL;
const adminCookie = process.env.ADMIN_COOKIE;

if (!baseUrl) {
  console.error('BASE_URL env var required (e.g., https://bpm-next.azurewebsites.net or http://localhost:3000/bpm)');
  process.exit(2);
}
if (!adminCookie) {
  console.error('ADMIN_COOKIE env var required (paste the admin_session cookie value from devtools)');
  process.exit(2);
}

const url = `${baseUrl.replace(/\/$/, '')}/api/admin/migrate-memberId`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `admin_session=${adminCookie}`,
    },
    body: JSON.stringify({ dryRun }),
  });

  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text);
    process.exit(2);
  }

  const summary = await res.json();
  console.log(JSON.stringify(summary, null, 2));

  if (Array.isArray(summary.collisions) && summary.collisions.length > 0) {
    console.error(`\nHALT: ${summary.collisions.length} collision(s) require manual review.`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('Migration request failed:', err);
  process.exit(2);
}
```

- [ ] **Step 6: Smoke-test the CLI script against local dev**

Start the dev server in another terminal: `npm run dev`. Sign in as admin in a browser. Copy the `admin_session` cookie value. Then:

```bash
BASE_URL='http://localhost:3000/bpm' ADMIN_COOKIE='<paste>' node scripts/migrate-memberId.mjs --dry-run
```

Expected: prints a JSON summary, exit code 0. No errors.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/migrate-memberId/route.ts scripts/migrate-memberId.mjs __tests__/migrate-memberId.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): memberId backfill route + CLI wrapper

Idempotent migration that links every players record to a members
doc via memberId, creating members where missing. Halts on name
collisions for manual review. Logic in the admin route (testable,
admin-gated); CLI script wraps the route via fetch with an admin
cookie. Mirrors the backfill-attendance pattern.
EOF
)"
```

---

## Task 7: Run the migration in dev → next → stable

This is an **operational task**, not a code change. Document it as a runbook so the engineer (or future-you) executes the migration in the right order.

- [ ] **Step 1: Local dev — dry run**

Sign in as admin in a browser at `http://localhost:3000/bpm`. Copy the `admin_session` cookie value from devtools.

```bash
BASE_URL='http://localhost:3000/bpm' ADMIN_COOKIE='<paste>' node scripts/migrate-memberId.mjs --dry-run
```

Expected: summary printed, exit 0, no collisions.

- [ ] **Step 2: Local dev — live run**

```bash
BASE_URL='http://localhost:3000/bpm' ADMIN_COOKIE='<paste>' node scripts/migrate-memberId.mjs
```

Expected: non-zero `linked`, possibly `created`, exit 0. (No-op if mock store is empty.)

- [ ] **Step 3: bpm-next — dry run**

Sign in as admin at `https://bpm-next.azurewebsites.net/bpm`. Copy the cookie.

```bash
BASE_URL='https://bpm-next.azurewebsites.net/bpm' ADMIN_COOKIE='<paste>' node scripts/migrate-memberId.mjs --dry-run
```

Inspect the output. **If `collisions.length > 0`, halt and surface them to the user before proceeding** — duplicate "Daisy" / "Mei" / etc. need to be resolved (rename one, or merge their player histories) before any live run.

- [ ] **Step 4: bpm-next — live run**

```bash
BASE_URL='https://bpm-next.azurewebsites.net/bpm' ADMIN_COOKIE='<paste>' node scripts/migrate-memberId.mjs
```

Expected: non-zero `linked`, possibly `created`, exit 0.

- [ ] **Step 5: bpm-stable — repeat steps 3 and 4**

Same procedure with `BASE_URL='https://bpm-stable.azurewebsites.net/bpm'`. **Do not run on stable until next has been verified for at least 24h** — gives the cron of normal usage a chance to surface any issue with the new write-path code that landed in Tasks 2-5.

- [ ] **Step 6: Mark the migration complete in MEMORY.md**

Add a single-line entry under "Project state" pointing at the date and result.

```bash
# Edit /Users/gz-mac/.claude/projects/-Users-gz-mac-Coding-projects-badminton-app/memory/MEMORY.md
# Add under ## Index → ### Project state:
#   - [project_memberId_migration_complete.md](project_memberId_migration_complete.md) — memberId backfill run on bpm-stable YYYY-MM-DD
```

Then create the linked memory file with the run summary (linked count, created count, any collisions resolved).

- [ ] **Step 7: No commit needed**

This is an operational task; no code changed. Move on to Plan 2.

---

## Verification (run after every task is complete)

- [ ] **Full test suite**

```bash
npm test
```

Expected: all tests pass; baseline of ~429 tests grows by ~20 (new tests added across tasks 2-6).

- [ ] **TypeScript clean**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Lint clean**

```bash
npm run lint
```

Expected: 0 errors. Warnings acceptable if project baseline already has them.

---

## Out of scope for Plan 1

- Any UI change (Plan 2)
- Any new read API (Plan 2)
- Any anomaly evaluation at read time (Plan 2)
- Receipt rendering (Plan 2)
- Demo fixture script (Plan 3)
- Runtime DB toggle (deferred — separate future spec)

---

## Self-review notes (delete after first execution)

- **Spec coverage check:** Section 2 (data model), Section 3 (memberId migration), partial section 5 (admin-side schema for `skipDates`/`eTransferRecipient`) all addressed. Section 5's `/api/sessions/recent`, `/api/admin/anomalies`, `/api/members/:id/history` are deferred to Plan 2. ✓
- **Placeholder scan:** No TBD/TODO. Every code block is complete. Every test has real assertions. ✓
- **Type consistency:** `PrevSessionSnapshot` and `ETransferRecipient` defined in Task 1, referenced consistently in Tasks 2-6. `getAdminMemberId` defined or referenced in Task 4 with a fallback path if it already exists under a different name. ✓
- **Migration architecture:** Logic lives in `app/api/admin/migrate-memberId/route.ts` (testable via vitest, admin-gated). CLI script in `scripts/migrate-memberId.mjs` is a thin fetch wrapper, mirroring the existing `scripts/backfill-attendance.mjs` pattern. Avoids the `.ts` import problem plain Node has. ✓
