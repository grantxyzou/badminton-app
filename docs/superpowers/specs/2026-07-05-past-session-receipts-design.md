# Past-session Receipts (Admin) Design

**Date**: 2026-07-05
**Status**: Design approved, awaiting written-spec review
**Audience**: Admin only (PIN-gated Command Center)

---

## 1. Scope & Success Criteria

Today the admin can generate a shareable receipt (copy text / share image, Group +
Individual) via `ReceiptSheet` — but **only for the current/active session**, because
the receipt builder is hardwired to fetch `/api/session`. There is no way to pull up a
**previous** session and see what it cost per person or re-send its receipt.

This feature makes past sessions' cost-per-person browsable and lets the admin open the
**existing** `ReceiptSheet` for any of them.

### In scope
- New admin nav row **"Past sessions"** → full-page list of recent sessions
  (date · attendance · cost-per-person).
- Tapping a row opens the existing `ReceiptSheet` for that session (Group + Individual,
  copy text + share image) — with **no second network fetch**.
- One new read endpoint: `GET /api/sessions/history`.
- One new shared pure function: `lib/buildReceiptInput.ts`.

### Out of scope
- Player-facing visibility (admin-only, per approved audience decision).
- Any change to `ReceiptSheet` — it is pure presentation and stays untouched.
- Any change to CommandCenter's live-session receipt path — no refactor (regression risk,
  zero user benefit).
- Fixing the pre-existing cover-unaware recompute in `members/[id]/history` — separate
  surface, out of scope. The two admin surfaces may disagree for covered sessions; that is
  a known, accepted pre-existing gap.
- Pagination / infinite scroll — the casual weekly group has few sessions; the existing
  `MAX_LIMIT` (24) is more than enough.
- Schema changes — everything needed is already on `Session` (`settled`,
  `eTransferRecipient`, cost inputs) and `Player`.

### Success criteria
1. Admin reaches "what did last Saturday cost per person?" in two taps from Command Center.
2. Admin can copy/share a receipt for **any** past session, not just the active one.
3. **The cost-per-person shown in the list row is byte-identical to the number on the
   receipt for that same session** — impossible to diverge (see §3).
4. A settled session's receipt reflects its frozen, cover-aware `costPerPerson`, not a
   naive recompute.

---

## 2. Architecture

### The single-resolver rule (why this feature is a correctness feature, not just UI)

This codebase already has **three** cost-per-person computations that can disagree for the
*same* session:

- `session/settle` freezes `costPerPerson` with a **cover-aware** denominator
  (`resplit`-covered players excluded, `absorb`-covered players included) into
  `SettledSnapshot`.
- `members/[id]/history` recomputes `totalCost / activePlayerCount` — **cover-unaware**,
  ignores the snapshot.
- CommandCenter's live receipt path recomputes for the *unsettled* active session.

If the new list row recomputed while the receipt read the snapshot, a covered session would
show one number in the list and another on the receipt. **The design eliminates the failure
mode structurally**: the list payload *carries the receipt object itself*, and the list
line renders `receipt.costPerPerson`. The list and the receipt are the same bytes.

### Shared pure function: `lib/buildReceiptInput.ts`

```ts
export function buildReceiptInput(
  session: Session,
  players: Pick<Player, 'name' | 'removed' | 'waitlisted'>[],
  recipient: ETransferRecipient | null,
): { input: ReceiptInput } | { error: string }
```

- **No recipient** → `{ error: 'Set an e-transfer recipient first (admin settings) before sharing.' }`
  (matches the string CommandCenter already surfaces).
- **Settled** (`session.settled` present) → **snapshot-first**: read `costPerPerson`,
  `totalCost`, `playerNames` from the frozen (cover-aware) snapshot. `courts` from
  `session.courts`.
- **Unsettled** → best-effort recompute using the **canonical** `sessionCostTotals(session)`
  helper (the same one `session/settle` uses — do not re-derive court/bird math): active =
  players not `removed`/`waitlisted`, `costPerPerson = round(totalCost / active.length)`.
  If `totalCost <= 0` or no active players → `{ error: 'This session has no recorded cost.' }`.
  (This still ignores cover modes, matching today's live-session behavior — cover-aware
  numbers only exist once a session is settled, which is the common case for *past*
  sessions.)
- Pure and deterministic — no fetch, no clock. Fully unit-testable.

### Endpoint: `GET /api/sessions/history`

- **Auth**: `isAdminAuthed(req)` → 401 otherwise.
- **Query**: `?limit=` (default 8, clamped to `MAX_LIMIT` 24), mirroring `sessions/recent`.
- **Recipient resolution**: `session.eTransferRecipient ?? <calling admin's global settings
  recipient>` (the global one read once, reused across rows).
- **Per-row build**: each session runs through `buildReceiptInput`. Rows are returned
  **whether or not** the receipt built — a row with no cost or no recipient still shows in
  the list (with its known cost, if any) and carries the reason.
- **Failure**: any Cosmos read failure → **503** (never a lying empty 200 — CLAUDE.md:
  "Lying empty state is forbidden"). Matches `sessions/costs`.

**Response shape:**
```ts
{
  sessions: Array<{
    sessionId: string;
    date: string;                 // session.datetime
    attendanceCount: number;      // active players
    paidPercent: number;          // for an at-a-glance "settled up?" hint
    costPerPerson: number | null; // convenience for the row; null if unknown
    receipt: ReceiptInput | null; // the exact object ReceiptSheet renders
    receiptError?: string;        // reason receipt is null (no cost / no recipient)
  }>;
}
```

Note: `costPerPerson` is a convenience mirror of `receipt?.costPerPerson`; when `receipt`
is present the row line uses `receipt.costPerPerson` so the two are the same value by
construction.

### Why a new endpoint, not extending `sessions/recent`

`sessions/recent` is a **lean summary** already consumed by `BirdInventoryCard` and
`RosterPage`. Bloating it with per-row `ReceiptInput` (player names, recipient) would weigh
down those unrelated callers. A dedicated endpoint keeps each contract focused.

---

## 3. UI

### `components/admin/CommandCenter/PastSessionsPage.tsx`

- Fetches `GET /api/sessions/history` **once** on mount. `ShimmerLoader` while loading;
  honest empty state ("No past sessions yet"); surfaced error on non-ok/503.
- Renders each session as a tappable row: **date · N players · $X/ea** (or "—" when
  `costPerPerson` is null). A subtle paid-status hint (e.g. "all paid" / "3 unpaid") is
  nice-to-have, derived from `paidPercent`.
- Owns its **own** `ReceiptSheet` instance + receipt state. Tapping a row with a non-null
  `receipt` sets `receiptInput = row.receipt` and opens the sheet — **no second fetch**.
  A row with `receipt: null` is non-opening; it shows `receiptError` inline (disabled feel).
- Header via `AdminBackHeader` / `PageHeader`, `onBack` prop — same pattern as `RosterPage`,
  `SetupPage`, `BirdsPage`.

### `ReceiptSheet` — UNCHANGED

Pure presentation given a `ReceiptInput`; renders Group + Individual client-side, fetches
nothing. Stated explicitly so implementation does not drift into editing it.

---

## 4. Wiring (minimal)

- `components/admin/types.ts` — add `'past-sessions'` to the `AdminView` union.
- `components/admin/CommandCenter/CommandCenter.tsx` — add nav row
  `{ icon: 'history', label: 'Past sessions', onClick: () => setView('past-sessions') }`
  (literal label, consistent with the existing literal-label rows).
- `components/admin/AdminDashboard.tsx` — add branch
  `if (view === 'past-sessions') return <div className="animate-slideInRight"><PastSessionsPage onBack={goBack} /></div>;`

---

## 5. Testing (vitest)

**`lib/buildReceiptInput.ts`**
1. Settled session → returns the snapshot's cover-aware `costPerPerson`/`totalCost`/
   `playerNames` verbatim (does **not** recompute).
2. Unsettled session with cost + active players → correct recompute.
3. Unsettled with `totalCost <= 0` or no active players → `{ error }`.
4. Null recipient → `{ error }` (recipient error takes precedence).

**`GET /api/sessions/history`**
5. Happy path → `sessions[]` shape; a settled row's `costPerPerson === receipt.costPerPerson`
   (the anti-divergence guarantee).
6. Not admin → 401.
7. Cosmos read throws → 503 (not empty 200).
8. Session with no recipient → row present, `receipt: null`, `receiptError` set,
   `costPerPerson` still populated from the (settled) snapshot when available.

---

## 6. File-change summary

| File | Change |
|------|--------|
| `lib/buildReceiptInput.ts` | **new** — shared pure resolver |
| `app/api/sessions/history/route.ts` | **new** — admin read endpoint |
| `components/admin/CommandCenter/PastSessionsPage.tsx` | **new** — list + own ReceiptSheet |
| `components/admin/types.ts` | add `'past-sessions'` to `AdminView` |
| `components/admin/CommandCenter/CommandCenter.tsx` | add nav row |
| `components/admin/AdminDashboard.tsx` | add view branch |
| `__tests__/buildReceiptInput.test.ts` | **new** |
| `__tests__/sessions-history.test.ts` | **new** |
| `ReceiptSheet.tsx`, CommandCenter live path, `members/history` | **unchanged** (explicit) |
