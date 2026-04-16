# Spec A1 — Cold Start Splash + Cost/Payment Visibility

**Date:** 2026-04-13
**Status:** Design approved, ready for implementation planning
**Parent:** Session A — Critical Usability Fixes (from `docs/user-research-simulation.md`)
**Sibling:** Spec A2 — Identity Recovery Bridge (separate design, to follow)

---

## 1. Purpose

Fix two user-research findings that both live on the HomeTab surface:

- **4.1 Cold Start White Screen** — 10-20s blank page on B1 cold starts causes abandonment (Marcus, Uncle Chen, Amy).
- **4.7 Cost Visibility Coupled to Announcement** — If admin hasn't posted an announcement, players can't see the cost (Priya).
- **4.8 Payment Info Disappears Post-Session** — E-transfer email + owed amount vanish when user isn't in the "signed up" state (Marcus, Linda).

These ship together because they all touch the Home surface and the broader "app feels visible and trustworthy" theme.

## 2. Scope

### In scope

1. **Cold start brand splash** rendered as pure HTML in `app/layout.tsx`, hidden via CSS selector on `<html data-hydrated="true">` once React mounts.
2. **Decouple current-session cost from the Announcement card.** Cost becomes a standalone glass-card above the announcement.
3. **Loosen the previous-session payment reminder gate** from `isSignedUp` to `hasIdentity` so players see what they owe even after session advance.

### Out of scope

- "I paid" button (explicitly deleted in prior session; do not reintroduce).
- Validating identity against the previous session's player roster (more complex; accepts a minor false-positive: a non-attendee with identity will see ambient prev-session cost info).
- Skeleton UI that mimics actual layout (branded splash chosen over facebook-style greyed placeholders).
- WeChat sharing, onboarding, i18n (planned for Sessions C and B).
- Mark-paid self-service (separate future work, not required for this fix).

## 3. Architecture

### Files touched

| File | Change |
|------|--------|
| `app/layout.tsx` | Add splash markup before `{children}`; mount `<HydrationMark />` inside the tree |
| `app/globals.css` | Add `.splash`, `.splash-shuttle`, `.splash-title`, `.splash-tagline` rules; add `html[data-hydrated="true"] .splash { display: none; }` selector; add `@keyframes` for shuttle animation |
| `components/HydrationMark.tsx` | **NEW** — tiny client component that sets `html[data-hydrated="true"]` on mount |
| `components/HomeTab.tsx` | Move cost out of announcement card into a new standalone card between tile row and announcement; add `hasIdentity` state; loosen prev-reminder gate |

No new API routes. No Cosmos schema changes. No new environment variables.

### Why this architecture

- **Splash in `layout.tsx`** — the only place that renders pre-hydration. `loading.tsx` is for route transitions, not initial load.
- **`data-hydrated` attribute on `<html>`** — simplest selector target; hides splash instantly on React mount without a timing-based fade.
- **Separate component for the hydration mark** — keeps `layout.tsx` server-component-compatible; `HydrationMark` is the only `'use client'` addition.
- **Standalone cost card above announcement** — preserves the documented HomeTab layout philosophy (context-on-top, action-on-bottom) while making cost unconditional.
- **Prev reminder stays below sign-up card** — placement still semantically correct as "what you owe from last time"; only the visibility condition changes.

## 4. Cold Start Splash

### 4.1 HTML structure (layout.tsx body, before `{children}`)

```tsx
<div className="splash" aria-hidden="true">
  <div className="splash-shuttle" />
  <h1 className="splash-title">BPM Badminton</h1>
  <p className="splash-tagline">Weekly sessions</p>
</div>
```

The existing `court-bg` / aurora divs already render pre-hydration. Splash sits above them.

### 4.2 Hide mechanism

1. `HydrationMark.tsx` (new):

```tsx
'use client';
import { useEffect } from 'react';

export default function HydrationMark() {
  useEffect(() => {
    document.documentElement.setAttribute('data-hydrated', 'true');
  }, []);
  return null;
}
```

2. Mount at the top of `app/page.tsx` (already a client component — adding `<HydrationMark />` as its first child keeps `layout.tsx` a server component).

3. CSS rule in `globals.css`:

```css
.splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: var(--bg-base);
  /* respects theme via CSS variables */
}
html[data-hydrated="true"] .splash { display: none; }
```

### 4.3 Shuttle animation

Pure CSS `@keyframes` — bouncing / spinning silhouette. Roughly 30 lines. Does **not** reuse `components/ShuttleLoader.tsx` because React components can't render pre-hydration.

### 4.4 Theme behavior

Splash uses CSS custom properties (`var(--bg-base)`, `var(--text-primary)`). Default theme is dark (set in `globals.css`). If the user previously selected light, the splash will briefly show in dark theme before flipping after `localStorage.badminton_theme` is read. Accepted trade-off — a blocking inline script to read localStorage pre-render adds complexity for a brief flash.

### 4.5 Accessibility

- `aria-hidden="true"` on splash root — it's a loading state, not content.
- `prefers-reduced-motion` honored: shuttle animation disabled via media query.

## 5. Cost/Payment Visibility

### 5.1 New standalone Cost card

**Location:** between tile row and Announcement card in `HomeTab.tsx`.

**Render condition** (identical to today's condition — only location changes):

```ts
effectiveSession?.showCostBreakdown
  && perPersonCost !== null
  && perPersonCost > 0
  && effectiveSession?.datetime
```

**Markup** (rendered inline, gated by the condition above):

```tsx
{effectiveSession?.showCostBreakdown && perPersonCost !== null && perPersonCost > 0 && effectiveSession?.datetime && (
  <div className="glass-card p-5 flex items-center justify-between">
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      Cost per person on {fmtDate(effectiveSession.datetime)}
    </p>
    <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
      ${perPersonCost.toFixed(2)}
    </p>
  </div>
)}
```

### 5.2 Remove cost from Announcement card

Delete lines 269–281 (cost block inside announcement) and the misleading comment at lines 262–264 in `HomeTab.tsx`. Announcement card returns to pure club-comms text.

### 5.3 Loosen prev-reminder gate

**Current** (line 485):

```ts
showCostBreakdown && (prevCostPerPerson ?? 0) > 0 && effectiveIsSignedUp
```

**New:**

```ts
showCostBreakdown && (prevCostPerPerson ?? 0) > 0 && hasIdentity
```

`hasIdentity` is new HomeTab state:

```tsx
const [hasIdentity, setHasIdentity] = useState(false);
useEffect(() => {
  setHasIdentity(getIdentity() !== null);
}, []);
```

`getIdentity()` is imported from `lib/identity.ts` (already exists).

### 5.4 Edge case matrix

| Scenario | Cost card | Prev reminder |
|----------|-----------|---------------|
| First-time visitor, no identity, no prev session | Shown iff cost set | Hidden |
| Identity exists, prevCost = 0 | Shown iff cost set | Hidden |
| Identity exists, prevCost > 0, not signed up for current | Shown iff cost set | **Shown (new)** |
| Identity exists, prevCost > 0, signed up for current | Shown iff cost set | Shown |
| `showCostBreakdown` off | Hidden | Hidden |
| DevPanel `?dev` overrides | Cost card responds to dev override; `hasIdentity` independent | Prev reminder responds to dev override for cost values |

## 6. Testing

### 6.1 Automated (Vitest + Testing Library)

This sprint introduces the first **component tests** in the codebase (prior 92 tests are all API-level). Implementer subagent will need to:

- Verify `@testing-library/react` and `jsdom` are available (or install).
- Follow TDD: write failing test, watch it fail, implement minimal fix, verify pass.

**New test files:**

- `__tests__/HomeTab.cost-card.test.tsx`
  - Cost card renders standalone when cost > 0 and no announcement
  - Cost card hidden when `showCostBreakdown` is off
  - Cost card hidden when `perPersonCost === null`
  - Cost card hidden when `perPersonCost === 0`
  - Cost card no longer renders inside announcement card
- `__tests__/HomeTab.prev-reminder.test.tsx`
  - Reminder shows when identity exists and prevCost > 0, regardless of sign-up state
  - Reminder hidden when no identity
  - Reminder hidden when `showCostBreakdown` off
  - Reminder hidden when prevCost is 0 or undefined

`getIdentity()` will be mocked per test to control identity state deterministically.

### 6.2 Manual verification

Not worth automating given cost and session frequency:

1. Hard refresh (incognito or disabled cache) — splash visible during load, disappears on hydration.
2. Splash theme matches `data-theme` once hydrated.
3. Cost card visually integrates between tile row and announcement (both themes).
4. Prev reminder still readable below sign-up card.
5. `?dev` URL flag flips cost visibility, identity, signed-up state and all combinations render correctly.
6. Lighthouse or manual check that cold start no longer shows blank page for entire hydration window.

### 6.3 Regression surface

- Existing API tests should still pass untouched — no API changes.
- Any snapshot tests referencing cost inside announcement (unlikely — no snapshot tests today) would need update.
- Visual: Announcement card height changes (no longer contains cost block). Acceptable.

## 7. Rollout

Single-branch, single-PR deploy via the existing `main` → Azure pipeline. No feature flag needed — the changes are user-visible improvements with no back-compat concern.

## 8. Success Criteria

- Cold-start white screen replaced with branded splash on all tested devices.
- Cost per person visible for current session regardless of announcement presence.
- Players with localStorage identity see last session's e-transfer email and cost even when not signed up for the current session.
- No regression in existing 92 tests.
- New component tests pass in CI.

## 9. Open Questions

None at spec close.

## 10. Appendix — Decisions Log

| Decision | Options | Chosen | Rationale |
|----------|---------|--------|-----------|
| Spec boundary | A / B / C | **C** — split A1 (UI) from A2 (identity recovery) | Identity recovery deserves own design doc; UI fixes are mechanical |
| Payment scope | A / B / C | **B** — fix both 4.7 and 4.8 | Same surface; splitting means touching same code twice |
| Cost layout | A / B / C | **B** — two separate slots | Preserves HomeTab ordering philosophy; two concepts ≠ one card |
| Cost card placement | A / B / C | **A** — above announcement | Cost is context; sits near date tile |
| Prev reminder gate | A / B / C | **A** — identity-exists | Simpler than roster check; harmless false-positive |
| Splash content | A / B / C | **C** — branded (shuttle + name + tagline) | Brand moment matters for first-time users; middle ground between sterile and mimicry |
