# Bird Cost Redesign + State Management Cleanup

**Branch:** `feature/bird-cost-and-state-cleanup`
**Date:** 2026-04-07
**Status:** In progress

---

## What This Branch Does (Plain English)

Three changes, done in order. Each builds on the last.

### Phase 1: Let admins edit bird purchases they already added
**Currently:** You can add a bird purchase or delete it. If you made a typo in the price, you have to delete and re-add it.
**After:** You can tap a purchase and edit any field — name, price, tubes, date, notes, everything.

> **Design analogy:** Adding an "edit" variant to a card component that was previously read-only + delete-only.

### Phase 2: Tie bird cost to a specific purchase
**Currently:** When you set "2 tubes used this session", the system grabs the price from whatever bird you bought most recently. If you buy new birds at a different price later, past sessions silently recalculate — the cost "floats."
**After:** You pick which specific purchase the tubes came from (e.g. "Victor Master No.3 — $20/tube, bought Apr 1"). The cost locks to that purchase forever.

> **Design analogy:** Instead of a component auto-inheriting the latest style token, you explicitly bind it to a specific token version. The binding is intentional, not ambient.

### Phase 3: Clean up AdminDashboard.tsx (934 lines → ~300 lines)
**Currently:** AdminDashboard has 47 independent state variables all at the root level — player data, announcements, session navigation, form states, loading flags, error messages. It works but it's like a Figma frame with 47 ungrouped layers.
**After:** Related state is extracted into 3 custom hooks (separate files). The Dashboard becomes an orchestrator that calls these hooks.

> **Design analogy:** Extracting repeated patterns from a mega-frame into reusable library components. The page just places the components — each one manages its own internal states.

---

## Key Concepts (Design ↔ Code)

### Custom Hook = Reusable Component in Your Design System

In Figma, when you have a card pattern used in multiple places, you extract it into a **component** in your library. The component owns its own layers, variants, and auto-layout. The page just *instances* it.

A **custom hook** is the same thing for state + logic. Instead of 21 `useState` calls scattered in the Dashboard for player management, you create `usePlayerManagement()` — a self-contained unit that owns all player state and actions. The Dashboard just calls it:

```tsx
// Before: 21 useState calls + 15 handler functions inline
const [players, setPlayers] = useState([])
const [adding, setAdding] = useState(false)
const [addError, setAddError] = useState('')
// ... 18 more ...

// After: one hook call
const players = usePlayerManagement(sessionId)
// players.list, players.add(), players.remove(), players.loading, etc.
```

### useReducer = Component Variants

In Figma, a button has variants: Default, Hover, Pressed, Loading, Disabled. At any moment it's in exactly one state. You can't be Loading AND Disabled AND Hover — those are **impossible states** that variants prevent.

`useReducer` does this in code. Instead of 5 independent booleans that could combine in nonsensical ways, you define named states and the rules for transitioning between them:

```tsx
// Before: independent booleans (Loading + Error simultaneously? Possible but wrong)
const [loading, setLoading] = useState(false)
const [error, setError] = useState('')
const [success, setSuccess] = useState(false)

// After: one state with defined variants (like Figma component variants)
// Can only be in ONE of these at a time:
//   { status: 'idle' }
//   { status: 'loading' }
//   { status: 'error', message: '...' }
//   { status: 'success' }
```

### PATCH Endpoint = Editing an Existing Record

REST API verbs map to familiar actions:
- **GET** = View/read (open a file)
- **POST** = Create new (duplicate a component)
- **PATCH** = Edit existing (modify a component's properties)
- **DELETE** = Remove (delete from canvas)

We're adding PATCH because the bird inventory currently only has Create (POST) and Delete — no Edit.

### Point Read vs Query = Direct Link vs Search

When the admin picks a specific purchase, the API does a **point read** — it goes directly to that record by ID. This is like opening a Figma file by its URL (instant) vs searching all your files for "Victor Master" (slower, might find the wrong one).

The old code did a query ("find all purchases, sort by date, grab the first one") which is the search approach.

---

## Safety Model

```
main (production)          ← deployed, tested, safe
  └── feature/bird-cost-and-state-cleanup  ← we work here
```

- **Nothing on this branch affects production** until we explicitly merge to main
- **52 tests must pass** before any merge can deploy
- **We can always abandon** this branch and main stays exactly as it is
- **Each phase is independently testable** — we can merge Phase 1 alone if Phase 2 gets complicated

---

## Files We'll Touch

### Phase 1 (Bird Purchase Editing)
- `app/api/birds/route.ts` — add PATCH handler
- `components/admin/BirdInventoryView.tsx` — add edit UI
- `__tests__/birds.test.ts` — add PATCH tests

### Phase 2 (Bird Cost Tied to Purchase)
- `lib/types.ts` — add `purchaseId` to `birdUsage` type
- `app/api/session/route.ts` — change PUT handler to look up specific purchase
- `components/admin/SessionDetailsEditor.tsx` — add purchase picker dropdown

### Phase 3 (State Cleanup)
- `components/admin/hooks/usePlayerManagement.ts` — new file
- `components/admin/hooks/useAnnouncements.ts` — new file
- `components/admin/hooks/useSessionNavigation.ts` — new file
- `components/admin/AdminDashboard.tsx` — refactor to use hooks (934 → ~300 lines)

---

## Verification

After each phase:
1. Run `npm test` — all tests pass
2. Check localhost:3000/bpm — admin tab works as before
3. No visual regressions for non-admin users
