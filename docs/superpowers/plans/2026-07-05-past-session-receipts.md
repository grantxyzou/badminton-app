# Past-session Receipts (Admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin browse previous sessions' cost-per-person and open a copy/paste-able receipt for any of them, reusing the existing `ReceiptSheet`.

**Architecture:** One shared pure resolver (`lib/buildReceiptInput.ts`) computes cost-per-person once — snapshot-first for settled sessions, best-effort recompute otherwise. A new admin read endpoint (`GET /api/sessions/history`) runs every recent session through that resolver and returns each row *carrying its own receipt object*, so the list's "$X/ea" and the receipt are the same bytes and cannot diverge. A new admin sub-page (`PastSessionsPage`) lists the rows and opens the untouched `ReceiptSheet` with the pre-loaded receipt — no second fetch.

**Tech Stack:** Next.js 16 App Router (route handlers), TypeScript, React 18 client components, Vitest + in-memory mock store, Azure Cosmos DB (via `getContainer`).

## Global Constraints

- **Read-only route auth**: admin read routes gate with `isAdminAuthed(req)` OR `isAdminAuthedWithMember(req)`; this route uses `isAdminAuthedWithMember` because it needs the caller's `memberId` to resolve their e-transfer recipient. Return `unauthorized()` (401) otherwise. Auth check is the first thing in the handler.
- **No lying empty state**: a Cosmos read failure returns **503** (`{ error }`), never a `200` + empty list. (CLAUDE.md.)
- **Mock store ignores `ORDER BY` / `LIMIT` / `IN()`**: fetch all, then sort/slice/post-filter in JS — mirror `app/api/sessions/recent/route.ts`.
- **Never use a numeric value as the left of `&&` in JSX**: use `(v ?? 0) > 0` or `!!v`. Applies to `costPerPerson`, counts.
- **Design tokens**: no bare hex color literals or raw inline `borderRadius` numbers in components — use `var(--accent)` / `var(--text-*)` / `var(--radius-*)`. Prefer `cc-btn*` classes, the `ListRow` primitive, `AdminBackHeader`, `ErrorState`/`EmptyState`, `AdminPageSkeleton`.
- **Cosmos `item()`**: `container.item(docId, partitionKeyValue)` — `members` PK is `/id`, so `container.item(memberId, memberId)`.
- **`ReceiptSheet`, CommandCenter's live-session receipt path, and `members/[id]/history` are OUT OF SCOPE and must not be edited.**
- Spec: `docs/superpowers/specs/2026-07-05-past-session-receipts-design.md`.

---

### Task 1: Shared receipt resolver `lib/buildReceiptInput.ts`

The correctness core. Computes cost-per-person ONCE per session and returns a fully-rendered `ReceiptInput` when a receipt can be built. Because both the list row and the receipt read from this single result, they cannot disagree.

**Files:**
- Create: `lib/buildReceiptInput.ts`
- Test: `__tests__/buildReceiptInput.test.ts`

**Interfaces:**
- Consumes: `sessionCostTotals(session)` from `lib/sessionCost.ts` → `{ courtTotal, birdTotal, totalCost }`; `ReceiptInput` from `lib/receiptTemplate.ts`; `Session`, `ETransferRecipient`, `SettledSnapshot` from `lib/types.ts`.
- Produces: `buildReceiptInput(session, players, recipient) => ReceiptBuild` where
  ```ts
  interface ReceiptBuild {
    costPerPerson: number | null;   // present whenever computable, even if no recipient
    input: ReceiptInput | null;     // the exact object ReceiptSheet renders; null if not buildable
    error?: string;                 // reason input is null
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/buildReceiptInput.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import type { Session } from '@/lib/types';

const RECIPIENT = { name: 'Grant', email: 'grant@example.com', memo: 'BPM {date} - {name}' };

function settledSession(over: Partial<Session> = {}): Session {
  return {
    id: 'session-2026-06-01',
    title: 'Sat',
    datetime: '2026-06-01T19:00:00-04:00',
    deadline: '2026-06-01T12:00:00-04:00',
    courts: 2,
    maxPlayers: 12,
    costPerCourt: 22,
    settled: {
      at: '2026-06-01T22:00:00-04:00',
      costPerPerson: 11,
      totalCost: 44,
      courtTotal: 44,
      birdTotal: 0,
      playerCount: 4,
      playerNames: ['Lin', 'Kento', 'Sindhu', 'Akane'],
    },
    ...over,
  } as Session;
}

describe('buildReceiptInput', () => {
  it('settled: reads cover-aware numbers + names from the frozen snapshot (no recompute)', () => {
    // costPerCourt*courts = 44 here too, but even if it did NOT, the snapshot wins.
    const s = settledSession({ costPerCourt: 999 }); // live recompute would be huge; snapshot must win
    const r = buildReceiptInput(s, [], RECIPIENT);
    expect(r.costPerPerson).toBe(11);
    expect(r.input).not.toBeNull();
    expect(r.input!.costPerPerson).toBe(11);
    expect(r.input!.totalCost).toBe(44);
    expect(r.input!.playerNames).toEqual(['Lin', 'Kento', 'Sindhu', 'Akane']);
    expect(r.input!.recipient).toEqual({ name: 'Grant', email: 'grant@example.com' });
    expect(r.input!.memoTemplate).toBe('BPM {date} - {name}');
    expect(r.error).toBeUndefined();
  });

  it('unsettled: recomputes totalCost / active players and lists active names', () => {
    const s = settledSession({ settled: undefined, costPerCourt: 20, courts: 2 }); // totalCost 40
    const players = [
      { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' },
      { name: 'Gone', removed: true }, { name: 'Wait', waitlisted: true },
    ];
    const r = buildReceiptInput(s, players, RECIPIENT);
    expect(r.costPerPerson).toBe(10); // 40 / 4 active
    expect(r.input!.costPerPerson).toBe(10);
    expect(r.input!.playerNames).toEqual(['A', 'B', 'C', 'D']);
  });

  it('unsettled with no cost → null cost, null input, NO_COST error', () => {
    const s = settledSession({ settled: undefined, costPerCourt: 0, courts: 2 });
    const r = buildReceiptInput(s, [{ name: 'A' }], RECIPIENT);
    expect(r.costPerPerson).toBeNull();
    expect(r.input).toBeNull();
    expect(r.error).toMatch(/no recorded cost/i);
  });

  it('no recipient → cost still computed, input null, recipient error', () => {
    const r = buildReceiptInput(settledSession(), [], null);
    expect(r.costPerPerson).toBe(11); // cost is known...
    expect(r.input).toBeNull();       // ...but the receipt cannot be addressed
    expect(r.error).toMatch(/e-transfer recipient/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/buildReceiptInput.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/buildReceiptInput"` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `lib/buildReceiptInput.ts`:

```ts
import type { ETransferRecipient, Session } from './types';
import type { ReceiptInput } from './receiptTemplate';
import { sessionCostTotals } from './sessionCost';

export interface ReceiptBuild {
  /** Per-person amount whenever it is computable (snapshot or recompute),
   *  even when no recipient is set — so the list row can still show the cost. */
  costPerPerson: number | null;
  /** The exact object `ReceiptSheet` renders. Null when a receipt can't be built. */
  input: ReceiptInput | null;
  /** Why `input` is null. Absent when `input` is present. */
  error?: string;
}

/** Minimal player shape the resolver needs — decoupled from the full `Player`. */
type RosterPlayer = { name: string; removed?: boolean; waitlisted?: boolean };

const NO_COST = 'This session has no recorded cost.';
const NO_RECIPIENT = 'Set an e-transfer recipient first (admin settings) before sharing.';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Single source of truth for "what did this past session cost per person, and
 * what's its receipt". Computes cost-per-person ONCE so a caller that shows the
 * number in a list and a caller that renders the receipt cannot disagree (the
 * three-way divergence risk documented in the spec §2).
 *
 * - Settled → snapshot-first: the frozen, cover-aware `costPerPerson` /
 *   `totalCost` / `playerNames` win over any live recompute.
 * - Unsettled → best-effort recompute via the canonical `sessionCostTotals`
 *   helper (cover modes only exist post-settle; this matches the live path).
 */
export function buildReceiptInput(
  session: Session,
  players: RosterPlayer[],
  recipient: ETransferRecipient | null,
): ReceiptBuild {
  let costPerPerson: number;
  let totalCost: number;
  let playerNames: string[];

  if (session.settled) {
    costPerPerson = session.settled.costPerPerson;
    totalCost = session.settled.totalCost;
    playerNames = session.settled.playerNames;
  } else {
    const active = players.filter((p) => !p.removed && !p.waitlisted);
    const totals = sessionCostTotals(session);
    if (totals.totalCost <= 0 || active.length === 0) {
      return { costPerPerson: null, input: null, error: NO_COST };
    }
    totalCost = totals.totalCost;
    costPerPerson = round2(totalCost / active.length);
    playerNames = active.map((p) => p.name);
  }

  // Cost is known from here. A receipt additionally needs someone to pay.
  if (!recipient) {
    return { costPerPerson, input: null, error: NO_RECIPIENT };
  }

  return {
    costPerPerson,
    input: {
      datetime: session.datetime,
      costPerPerson,
      courts: session.courts ?? 0,
      totalCost,
      playerNames,
      recipient: { name: recipient.name, email: recipient.email },
      ...(recipient.memo ? { memoTemplate: recipient.memo } : {}),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/buildReceiptInput.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add lib/buildReceiptInput.ts __tests__/buildReceiptInput.test.ts
git commit -m "feat(receipts): shared cost-per-person + receipt resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EMnND5EbYvoTwDHRa8roGc"
```

---

### Task 2: Read endpoint `GET /api/sessions/history`

Runs each recent session through `buildReceiptInput` and returns rows that carry their own receipt, guaranteeing list/receipt agreement.

**Files:**
- Create: `app/api/sessions/history/route.ts`
- Test: `__tests__/sessions-history.test.ts`

**Interfaces:**
- Consumes: `buildReceiptInput` (Task 1); `getContainer`, `POINTER_ID` from `lib/cosmos.ts`; `isAdminAuthedWithMember`, `unauthorized` from `lib/auth.ts`; `Session`, `Member`, `ETransferRecipient` from `lib/types.ts`.
- Produces: `GET(req: NextRequest)` returning JSON
  ```ts
  { sessions: Array<{
      sessionId: string;
      date: string;
      attendanceCount: number;
      paidPercent: number;
      costPerPerson: number | null;
      receipt: ReceiptInput | null;
      receiptError?: string;
  }> }
  ```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/sessions-history.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { GET } from '@/app/api/sessions/history/route';
import {
  resetMockStore, setupAdminPin, seedPointer, seedSession, seedPlayer,
  seedAdminMember, makeAdminRequest, makeRequest,
} from './helpers';

setupAdminPin();

const ACTIVE = 'session-2026-06-08';
const PAST = 'session-2026-06-01';
const URL = 'http://localhost:3000/api/sessions/history';
const RECIPIENT = { name: 'Grant', email: 'grant@example.com', memo: 'BPM {date} - {name}' };

function settled() {
  return {
    at: '2026-06-01T22:00:00-04:00', costPerPerson: 11, totalCost: 44,
    courtTotal: 44, birdTotal: 0, playerCount: 4,
    playerNames: ['Lin', 'Kento', 'Sindhu', 'Akane'],
  };
}

describe('GET /api/sessions/history', () => {
  beforeEach(() => {
    resetMockStore();
    seedAdminMember({ eTransferRecipient: RECIPIENT });
    seedPointer(ACTIVE);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a non-admin with 401', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    const res = await GET(makeRequest('GET', URL));
    expect(res.status).toBe(401);
  });

  it('settled row: costPerPerson equals its receipt.costPerPerson (anti-divergence)', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00', courts: 2 });
    seedPlayer(PAST, 'Lin', { paid: true });
    seedPlayer(PAST, 'Kento', { paid: false });

    const res = await GET(makeAdminRequest('GET', URL));
    expect(res.status).toBe(200);
    const data = await res.json();
    const row = data.sessions.find((s: { sessionId: string }) => s.sessionId === PAST);

    expect(row.costPerPerson).toBe(11);
    expect(row.receipt).not.toBeNull();
    expect(row.receipt.costPerPerson).toBe(11);
    expect(row.receipt.playerNames).toEqual(['Lin', 'Kento', 'Sindhu', 'Akane']);
    expect(row.paidPercent).toBe(50); // 1 of 2 active roster paid
    expect(row.attendanceCount).toBe(2);
  });

  it('no recipient: row still shows cost, receipt null with a reason', async () => {
    seedAdminMember({ eTransferRecipient: undefined }); // clear global recipient
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });

    const res = await GET(makeAdminRequest('GET', URL));
    const data = await res.json();
    const row = data.sessions.find((s: { sessionId: string }) => s.sessionId === PAST);

    expect(row.costPerPerson).toBe(11);
    expect(row.receipt).toBeNull();
    expect(row.receiptError).toMatch(/e-transfer recipient/i);
  });

  it('returns 503 when the sessions read throws (not a lying empty 200)', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    // Break ONLY the sessions container so auth (members) still succeeds.
    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name === 'sessions') throw new Error('cosmos down');
      return realGetContainer(name);
    });
    const res = await GET(makeAdminRequest('GET', URL));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/sessions-history.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/sessions/history/route"`.

- [ ] **Step 3: Write the implementation**

Create `app/api/sessions/history/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getContainer, POINTER_ID } from '@/lib/cosmos';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import type { ETransferRecipient, Member, Session } from '@/lib/types';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

/**
 * GET /api/sessions/history — admin-only list of recent sessions, each row
 * carrying a ready-to-render receipt (or the reason it can't be built). The
 * row's `costPerPerson` is the SAME value inside `receipt`, produced by the
 * single `buildReceiptInput` resolver, so the list and the receipt can never
 * disagree (spec §2, §3).
 */
export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  const params = new URL(req.url).searchParams;
  const requested = parseInt(params.get('limit') ?? '', 10);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));

  try {
    const sessionsContainer = getContainer('sessions');
    const playersContainer = getContainer('players');
    const membersContainer = getContainer('members');

    // The calling admin's own recipient is the default; a session may override it.
    const { resource: adminMember } = await membersContainer
      .item(auth.memberId, auth.memberId)
      .read<Member & { eTransferRecipient?: ETransferRecipient }>();
    const globalRecipient: ETransferRecipient | null = adminMember?.eTransferRecipient ?? null;

    // All real sessions (exclude pointer + legacy). Sort + slice in JS — the
    // mock store ignores ORDER BY / LIMIT (same contract as sessions/recent).
    const { resources: allSessions } = await sessionsContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id != @pointerId AND c.id != @legacyId',
        parameters: [
          { name: '@pointerId', value: POINTER_ID },
          { name: '@legacyId', value: 'current-session' },
        ],
      })
      .fetchAll();
    const sessions = (allSessions as Session[])
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, limit);

    // Batched player fetch; the mock ignores IN() and returns everything, so
    // post-filter by the id set (same contract as sessions/recent).
    type PlayerRow = { sessionId: string; name: string; paid?: boolean; removed?: boolean; waitlisted?: boolean };
    const sessionIds = sessions.map((s) => s.id);
    const sessionIdSet = new Set(sessionIds);
    const playersBySession = new Map<string, PlayerRow[]>();
    if (sessionIds.length > 0) {
      const placeholders = sessionIds.map((_, i) => `@sid${i}`).join(',');
      const { resources: rawPlayers } = await playersContainer.items
        .query({
          query: `SELECT c.sessionId, c.name, c.paid, c.removed, c.waitlisted FROM c WHERE c.sessionId IN (${placeholders})`,
          parameters: sessionIds.map((id, i) => ({ name: `@sid${i}`, value: id })),
        })
        .fetchAll();
      for (const p of rawPlayers as PlayerRow[]) {
        if (!sessionIdSet.has(p.sessionId)) continue;
        const arr = playersBySession.get(p.sessionId);
        if (arr) arr.push(p);
        else playersBySession.set(p.sessionId, [p]);
      }
    }

    const out = sessions.map((s) => {
      const roster = playersBySession.get(s.id) ?? [];
      const active = roster.filter((p) => !p.removed && !p.waitlisted);
      const paidCount = active.filter((p) => p.paid === true).length;
      const paidPercent = active.length > 0 ? Math.round((paidCount / active.length) * 100) : 0;

      const recipient = s.eTransferRecipient ?? globalRecipient;
      const build = buildReceiptInput(s, roster, recipient);

      return {
        sessionId: s.id,
        date: s.datetime ?? '',
        attendanceCount: active.length,
        paidPercent,
        costPerPerson: build.costPerPerson,
        receipt: build.input,
        ...(build.error ? { receiptError: build.error } : {}),
      };
    });

    return NextResponse.json({ sessions: out });
  } catch (error) {
    // 503, never a lying empty 200 (CLAUDE.md). Clients guard on res.ok.
    console.error('GET /api/sessions/history error:', error);
    return NextResponse.json({ error: 'Failed to load session history' }, { status: 503 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/sessions-history.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add app/api/sessions/history/route.ts __tests__/sessions-history.test.ts
git commit -m "feat(receipts): GET /api/sessions/history — past sessions + carried receipts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EMnND5EbYvoTwDHRa8roGc"
```

---

### Task 3: `PastSessionsPage` UI + admin wiring

The admin-facing list. Fetches `/api/sessions/history` once, renders a tappable row per session (date · N players · $X/ea), and opens the untouched `ReceiptSheet` with the row's pre-loaded receipt.

**Files:**
- Create: `components/admin/CommandCenter/PastSessionsPage.tsx`
- Modify: `components/admin/types.ts` (add `'past-sessions'` to `AdminView`)
- Modify: `components/admin/CommandCenter/CommandCenter.tsx` (add one nav row)
- Modify: `components/admin/AdminDashboard.tsx` (import + render branch)

**Interfaces:**
- Consumes: `GET /api/sessions/history` (Task 2); `ReceiptSheet` (existing, unchanged) — props `{ open, onClose, input, error, initialMode, initialPlayerName }`; `ReceiptInput` from `lib/receiptTemplate.ts`; `AdminBackHeader` (props `{ onBack, title }`); `AdminPageSkeleton` from `components/primitives/CardSkeleton`; `ErrorState` (props `{ message }`), `EmptyState` (children), `ListRow` (props `{ leading?, title, subtitle?, trailing?, onClick? }`) from `components/primitives/`; `fmtShortDate(iso)` from `lib/fmt`.
- Produces: `PastSessionsPage({ onBack }: { onBack: () => void })` default export.

- [ ] **Step 1: Add the `AdminView` member**

In `components/admin/types.ts`, add `'past-sessions'` to the union:

```ts
export type AdminView =
  | 'dashboard'
  | 'session-details'
  | 'date-time'
  | 'members'
  | 'birds'
  | 'advance'
  | 'players-full'
  | 'releases'
  | 'ledger'
  | 'payments'
  | 'announcements'
  | 'etransfer'
  | 'skip-dates'
  | 'past-sessions';
```

- [ ] **Step 2: Create the page component**

Create `components/admin/CommandCenter/PastSessionsPage.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import ListRow from '@/components/primitives/ListRow';
import ReceiptSheet from './ReceiptSheet';
import { fmtShortDate } from '@/lib/fmt';
import type { ReceiptInput } from '@/lib/receiptTemplate';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface HistoryRow {
  sessionId: string;
  date: string;
  attendanceCount: number;
  paidPercent: number;
  costPerPerson: number | null;
  receipt: ReceiptInput | null;
  receiptError?: string;
}

interface PastSessionsPageProps {
  onBack: () => void;
}

export default function PastSessionsPage({ onBack }: PastSessionsPageProps) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Receipt sheet state — this page owns its OWN instance (it renders instead
  // of CommandCenter, so it can't reuse CommandCenter's sheet).
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptInput, setReceiptInput] = useState<ReceiptInput | null>(null);
  const [receiptError, setReceiptError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/sessions/history`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { sessions: HistoryRow[] };
        if (!cancelled) setRows(data.sessions);
      } catch {
        // Distinguish load-failure from loaded-empty (CLAUDE.md: no lying empty state).
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openReceipt = useCallback((row: HistoryRow) => {
    if (!row.receipt) {
      setReceiptInput(null);
      setReceiptError(row.receiptError ?? 'No receipt available for this session.');
    } else {
      setReceiptError('');
      setReceiptInput(row.receipt);
    }
    setReceiptOpen(true);
  }, []);

  return (
    <div className="animate-slideInRight">
      <AdminBackHeader onBack={onBack} title="Past sessions" />

      <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {loadError ? (
          <ErrorState message="Couldn't load past sessions — refresh to retry." />
        ) : rows === null ? (
          <AdminPageSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState>No past sessions yet.</EmptyState>
        ) : (
          rows.map((row) => {
            const hasCost = (row.costPerPerson ?? 0) > 0;
            const paidLabel =
              row.attendanceCount > 0
                ? row.paidPercent >= 100
                  ? 'all paid'
                  : `${row.paidPercent}% paid`
                : '';
            const subtitle = [
              `${row.attendanceCount} player${row.attendanceCount === 1 ? '' : 's'}`,
              paidLabel,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <ListRow
                key={row.sessionId}
                onClick={() => openReceipt(row)}
                ariaLabel={`Receipt for ${fmtShortDate(row.date)}`}
                title={
                  <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', fontWeight: 600 }}>
                    {fmtShortDate(row.date) || row.sessionId}
                  </span>
                }
                subtitle={subtitle}
                trailing={
                  <span
                    className="fs-md"
                    style={{
                      fontFamily: 'var(--font-mono), ui-monospace, monospace',
                      color: hasCost ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {hasCost ? `$${row.costPerPerson}/ea` : '—'}
                  </span>
                }
              />
            );
          })
        )}
      </div>

      <ReceiptSheet
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        input={receiptInput}
        error={receiptError || undefined}
      />
    </div>
  );
}
```

- [ ] **Step 3: Add the Command Center nav row**

In `components/admin/CommandCenter/CommandCenter.tsx`, add a row to the nav `rows` array. Insert the `Past sessions` entry directly after the `Ledger` row (`receipt_long` glyph is already in the icon subset — do NOT introduce a new glyph):

```tsx
            { icon: 'receipt_long', label: 'Ledger', onClick: () => setView('ledger') },
            { icon: 'receipt_long', label: 'Past sessions', onClick: () => setView('past-sessions') },
            { icon: 'bolt', label: 'Release notes', onClick: () => setView('releases') },
```

- [ ] **Step 4: Wire the render branch**

In `components/admin/AdminDashboard.tsx`:

Add the import alongside the other CommandCenter page imports (near `import SetupPage from './CommandCenter/SetupPage';`):

```tsx
import PastSessionsPage from './CommandCenter/PastSessionsPage';
```

Add the render branch next to the other `view === ...` branches (e.g. immediately after the `view === 'skip-dates'` branch, before the `CommandCenter` fallback return). `PastSessionsPage` renders its own `animate-slideInRight` wrapper, so do NOT wrap it again:

```tsx
  if (view === 'past-sessions') {
    return <PastSessionsPage onBack={goBack} />;
  }
```

- [ ] **Step 5: Typecheck, lint, and full test suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npm run lint`
Expected: no new errors (token-guardrail: the page uses `var(--*)` tokens and `fs-*` classes — no bare hex, no raw inline `borderRadius`).

Run: `npm test`
Expected: all suites pass, including the two new ones from Tasks 1–2.

- [ ] **Step 6: Manual smoke test (mock store, no DB)**

Run the app against the mock store with a seeded admin + scenario:

```bash
COSMOS_CONNECTION_STRING= SEED_DEV_SCENARIO=fresh-thursday SEED_DEV_ADMIN=Grant:1130 npm run dev:next
```

Then in the browser at `http://localhost:3000/bpm`:
1. Profile → "Admin tools →", enter PIN `1130`.
2. In the Command Center menu, confirm the new **"Past sessions"** row appears (receipt icon).
3. Tap it → the list renders (date · N players · $X/ea) or an honest "No past sessions yet" if the seed has none. (To get a settled past session to browse, advance the seeded session and settle the prior one via the admin flow, or seed a settled session.)
4. Tap a row with a cost → `ReceiptSheet` opens; verify **Copy text** copies the receipt and the number matches the row's "$X/ea".
5. Verify a row with no e-transfer recipient set opens the sheet showing the "Set an e-transfer recipient…" reason rather than a broken receipt.

Note in the commit/PR if any manual step could not be exercised with the current seed.

- [ ] **Step 7: Commit**

```bash
git add components/admin/CommandCenter/PastSessionsPage.tsx \
        components/admin/types.ts \
        components/admin/CommandCenter/CommandCenter.tsx \
        components/admin/AdminDashboard.tsx
git commit -m "feat(receipts): admin Past-sessions page — browse + copy past receipts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EMnND5EbYvoTwDHRa8roGc"
```

---

## Self-Review

**Spec coverage:**
- Nav row → full-page list → tap → `ReceiptSheet` → Task 3. ✓
- Shared snapshot-first resolver → Task 1. ✓
- `GET /api/sessions/history` carrying receipts, 503-on-failure, admin gate → Task 2. ✓
- Recipient resolution (`session.eTransferRecipient ?? global`) → Task 2 route. ✓
- List/receipt anti-divergence guarantee → Task 1 (single compute) + Task 2 test asserting `row.costPerPerson === row.receipt.costPerPerson`. ✓
- `ReceiptSheet` / live path / `members/history` untouched → no task modifies them; stated in Global Constraints. ✓
- Tests: 4 resolver + 4 endpoint = the spec's 8 cases. ✓

**Type consistency:** `ReceiptBuild` shape (`costPerPerson` / `input` / `error`) is defined in Task 1 and consumed identically in Task 2. `HistoryRow` fields in Task 3 match the endpoint's response object in Task 2. `ReceiptSheet` props used in Task 3 (`open`/`onClose`/`input`/`error`) match the existing component signature. `buildReceiptInput(session, players, recipient)` argument order is identical across Tasks 1–2.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; no "add error handling" hand-waves.
