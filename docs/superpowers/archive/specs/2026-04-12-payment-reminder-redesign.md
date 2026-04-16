# Payment Reminder Redesign

## Problem

The "I paid" UI currently lives inside the sign-up card for the *upcoming* session, with cost labeled "Cost per person on [upcoming date]". Players read this as "pay now for the session you just signed up for." The actual intent is the opposite — it's a reminder to settle up for **last week's session** (payment happens after playing).

## Solution

Replace the in-card payment block with subtle, standalone reminder text below the sign-up card. The reminder explicitly references the previous session date and cost-per-person. No card, no border — just muted informational text. No "I paid" button or self-report flow — just a passive reminder.

## Data Model

### New fields on `Session` (in `lib/types.ts`)

```ts
prevSessionDate?: string;     // ISO datetime of the previous session
prevCostPerPerson?: number;   // Calculated cost-per-person from previous session
```

These are snapshots frozen at advance time. They do not update if the archived session is later edited.

## Changes by File

### 1. `lib/types.ts`

Add `prevSessionDate?: string` and `prevCostPerPerson?: number` to the `Session` interface.

### 2. `app/api/session/advance/route.ts`

Before creating the new session:

1. Load the current (soon-to-be-previous) session (already fetched at line 26-29)
2. Count active players: query the `players` container for the current session, filter `removed !== true` and `waitlisted !== true`
3. Calculate cost:
   - `courtTotal = currentSession.costPerCourt * currentSession.courts`
   - `birdTotal = totalBirdCost(normalizeBirdUsages(currentSession))`
   - `prevCostPerPerson = (courtTotal + birdTotal) / activePlayerCount` (or `0` if no players)
4. Add to new session document:
   - `prevSessionDate: currentSession.datetime`
   - `prevCostPerPerson` (rounded to 2 decimal places)

### 3. `components/HomeTab.tsx`

**Remove:** The `inner-card` payment block (e-transfer + "I paid" button + paid states) currently inside the signed-up state (lines ~368-396). Also remove the `handleReportPaid` function, `reportingPaid` state, and `selfReportedPaid` references from HomeTab.

**Add:** Below the sign-up card's closing `</div>`, render the subtle reminder:

```text
Last session (Apr 12) · $4.50/person
E-transfer to grantxyzou@gmail.com
```

**Visibility conditions** (all must be true):

- `effectiveSession?.showCostBreakdown` is true
- `effectiveSession?.prevCostPerPerson > 0`
- Player is signed up (`effectiveIsSignedUp`)

**Styling:**

- Both lines: `text-xs`, `text-center`
- Line 1: `color: var(--text-muted)`
- Line 2: `color: var(--text-muted)`
- Gap between lines: `mt-0.5` (tight)
- Gap from sign-up card above: `mt-3`

No interactive elements. No "I paid" button. No state transitions. Pure informational text.

**Date formatting:** Use the existing `fmtDate()` helper on `prevSessionDate`.

### 4. `components/DevPanel.tsx`

Add a `prevCostPerPerson` slider (0-20, step 0.5) to the dev panel controls so the reminder is testable in all states.

Add the field to `DevOverrides` type:
```ts
prevCostPerPerson?: number | null;
```

### 5. `components/HomeTab.tsx` (dev override wiring)

In the `effectiveSession` computation, merge `prevCostPerPerson` and `prevSessionDate` from dev overrides. Use a synthetic previous date (7 days before session datetime) when dev mode provides a `prevCostPerPerson` but the real session has no `prevSessionDate`.

## What Gets Removed

- **`handleReportPaid`** function in HomeTab
- **`reportingPaid`** state in HomeTab
- **`selfReportedPaid` UI** references in HomeTab (the "Reported — awaiting confirmation" and "I paid" button)
- **`inner-card` payment block** inside the signed-up state

The `selfReportedPaid` field stays on the Player type and in the API (admin can still see it in AdminDashboard) — we're only removing the player-facing self-report UI from HomeTab.

## What Does NOT Change

- **Cost-per-person in announcement card** — stays as-is, still shows the upcoming session's cost
- **Admin payment tracking** (AdminDashboard paid toggle) — unchanged
- **`selfReportedPaid` API route** — stays in case it's needed later
- **`showCostBreakdown` toggle behavior** — controls reminder visibility (as just fixed)

## Verification

1. **Advance a session** with costPerCourt=20, courts=2, 8 players → new session should have `prevCostPerPerson: 5.00` and `prevSessionDate` set
2. **Player view:** Signed up + toggle on + prev cost exists → see subtle reminder text with previous date and e-transfer email
3. **Toggle off** → reminder hidden
4. **Not signed up** → reminder hidden
5. **No previous cost** → reminder hidden
6. **Dev panel:** Slide prevCostPerPerson slider → reminder appears/disappears reactively
7. **Run `npm test`** — all existing tests pass + new test for advance snapshot
