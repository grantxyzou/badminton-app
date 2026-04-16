# Cold Start Splash + Cost/Payment Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three usability findings on the BPM Badminton Home surface — cold start white screen, cost-coupled-to-announcement, and disappearing post-session payment info.

**Architecture:** Add a pure-HTML pre-hydration splash to `app/layout.tsx` (hidden via CSS once React mounts via a tiny `HydrationMark` client component). Extract cost and prev-payment-reminder render logic from `HomeTab.tsx` into two pure presentational components (`CostCard`, `PrevPaymentReminder`) so the logic is testable without mocking the full fetch-heavy HomeTab. Relocate cost above the announcement; loosen the prev-reminder gate from `isSignedUp` to `hasIdentity`.

**Tech Stack:** Next.js 16 (app router), TypeScript, React 18, Tailwind, Vitest, new: `@testing-library/react` + `jsdom`

**Spec:** [2026-04-13-cold-start-and-payment-visibility-design.md](../specs/2026-04-13-cold-start-and-payment-visibility-design.md)

---

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `components/CostCard.tsx` | NEW | Pure presentational — renders "Cost per person on [date]" + "$X.XX" given props |
| `components/PrevPaymentReminder.tsx` | NEW | Pure presentational — renders prev-session cost + e-transfer reminder given props |
| `components/HydrationMark.tsx` | NEW | Client component — sets `html[data-hydrated="true"]` on mount |
| `components/HomeTab.tsx` | MODIFY | Remove inline cost-in-announcement; mount CostCard + PrevPaymentReminder; add `hasIdentity` state |
| `app/layout.tsx` | MODIFY | Add pre-hydration splash markup in `<body>` before `{children}` |
| `app/page.tsx` | MODIFY | Mount `<HydrationMark />` as first child |
| `app/globals.css` | MODIFY | Add splash styles + `html[data-hydrated="true"] .splash { display: none; }` + shuttle keyframes |
| `vitest.config.ts` | MODIFY | No change — per-test-file env via `// @vitest-environment jsdom` docblock |
| `package.json` | MODIFY | Add devDeps: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` |
| `__tests__/components/CostCard.test.tsx` | NEW | Tests for CostCard presentational rules |
| `__tests__/components/PrevPaymentReminder.test.tsx` | NEW | Tests for PrevPaymentReminder presentational rules |
| `__tests__/components/HydrationMark.test.tsx` | NEW | Tests that HydrationMark sets the hydration attribute on mount |

---

## Task 1: Install component-testing dependencies

**Files:**
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install devDeps**

Run:
```bash
cd "/Users/gz-mac/Coding projects/badminton-app"
npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Verify install**

Run:
```bash
node -e "console.log(require('./package.json').devDependencies)" | grep -E "testing-library|jsdom"
```
Expected: three lines showing `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.

- [ ] **Step 3: Confirm existing tests still pass**

Run:
```bash
npm test
```
Expected: 92/92 tests pass (existing API suites untouched).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @testing-library/react + jsdom for component tests"
```

---

## Task 2: HydrationMark component (TDD)

**Files:**
- Create: `components/HydrationMark.tsx`
- Test: `__tests__/components/HydrationMark.test.tsx`

- [ ] **Step 1: Write failing test**

Create `__tests__/components/HydrationMark.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import HydrationMark from '../../components/HydrationMark';

describe('HydrationMark', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-hydrated');
  });

  it('sets data-hydrated="true" on <html> after mount', () => {
    expect(document.documentElement.getAttribute('data-hydrated')).toBeNull();
    render(<HydrationMark />);
    expect(document.documentElement.getAttribute('data-hydrated')).toBe('true');
  });

  it('renders nothing to the DOM', () => {
    const { container } = render(<HydrationMark />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run __tests__/components/HydrationMark.test.tsx
```
Expected: FAIL with "Cannot find module '../../components/HydrationMark'" or similar.

- [ ] **Step 3: Write minimal implementation**

Create `components/HydrationMark.tsx`:

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

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run __tests__/components/HydrationMark.test.tsx
```
Expected: PASS (2/2).

- [ ] **Step 5: Run full test suite**

Run:
```bash
npm test
```
Expected: all tests pass, including the new 2 (total = 94).

- [ ] **Step 6: Commit**

```bash
git add components/HydrationMark.tsx __tests__/components/HydrationMark.test.tsx
git commit -m "feat: add HydrationMark client component

Flips html[data-hydrated] attribute on mount. Used to hide the
cold-start splash once React has hydrated."
```

---

## Task 3: Splash markup + CSS in layout.tsx and globals.css

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `app/page.tsx`

No unit tests for this task — splash is a purely visual element verified manually (see Task 3, Step 6 below).

- [ ] **Step 1: Add splash styles to globals.css**

Append to `app/globals.css` (at the end of the file):

```css
/* ── Cold-start splash ──
   Rendered in layout.tsx body before React hydrates. Hidden once
   HydrationMark sets data-hydrated="true" on <html>. */
.splash {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: var(--bg-base, #0a0a0a);
  color: var(--text-primary, #ffffff);
  pointer-events: none;
}
html[data-hydrated="true"] .splash {
  display: none;
}
.splash-shuttle {
  width: 48px;
  height: 48px;
  border: 3px solid var(--accent, #4ade80);
  border-top-color: transparent;
  border-radius: 50%;
  animation: splash-spin 0.9s linear infinite;
}
.splash-title {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin: 0;
}
.splash-tagline {
  font-size: 0.875rem;
  opacity: 0.7;
  margin: 0;
}
@keyframes splash-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .splash-shuttle { animation: none; }
}
```

- [ ] **Step 2: Add splash markup to layout.tsx**

In `app/layout.tsx`, in the `<body>` block (currently lines 40-48), add the splash div **before** the court-bg div:

```tsx
<body>
  {/* Cold-start splash — hidden by CSS once HydrationMark sets data-hydrated */}
  <div className="splash" aria-hidden="true">
    <div className="splash-shuttle" />
    <h1 className="splash-title">BPM Badminton</h1>
    <p className="splash-tagline">Weekly sessions</p>
  </div>
  {/* Badminton court background */}
  <div className="court-bg" aria-hidden="true">
    <div className="aurora-blob-1" />
    <div className="aurora-blob-2" />
    <div className="aurora-blob-3" />
  </div>
  {children}
</body>
```

- [ ] **Step 3: Mount HydrationMark in page.tsx**

At the top of `app/page.tsx` (after the imports, inside the default export's JSX), add `<HydrationMark />` as the first child of the root element.

If `app/page.tsx` currently starts with:
```tsx
export default function Page() {
  return (
    <main>
      {/* ... */}
    </main>
  );
}
```

Change to:
```tsx
import HydrationMark from '@/components/HydrationMark';

export default function Page() {
  return (
    <>
      <HydrationMark />
      <main>
        {/* ... */}
      </main>
    </>
  );
}
```

(Use the Read tool on `app/page.tsx` first to see the actual structure — adapt the insertion to match. `HydrationMark` must be inside the client-rendered tree; location within the page doesn't matter beyond that.)

- [ ] **Step 4: Run tests**

Run:
```bash
npm test
```
Expected: all tests still pass (94).

- [ ] **Step 5: Manual dev-server visual check**

Run:
```bash
npm run dev
```
Open `http://localhost:3000/bpm` in an incognito window (or with cache disabled). Observe:
- Splash (shuttle + title + tagline) appears immediately.
- Splash disappears as soon as the page hydrates (typically < 1s locally).
- In DOM inspector: `<html>` has `data-hydrated="true"` after load.

Stop the dev server (`Ctrl+C`).

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/globals.css app/page.tsx
git commit -m "feat: add pre-hydration splash to layout

Replaces the cold-start white screen with a branded loading state
(shuttle spinner + BPM Badminton + tagline). Hidden via CSS once
HydrationMark sets html[data-hydrated='true'] after React mounts."
```

---

## Task 4: CostCard presentational component (TDD)

**Files:**
- Create: `components/CostCard.tsx`
- Test: `__tests__/components/CostCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `__tests__/components/CostCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CostCard from '../../components/CostCard';

describe('CostCard', () => {
  it('renders cost and formatted date when all conditions met', () => {
    render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={11.25}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(screen.getByText(/Cost per person on/i)).toBeTruthy();
    expect(screen.getByText('$11.25')).toBeTruthy();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={false}
        perPersonCost={11.25}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is null', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={null}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when perPersonCost is zero', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={0}
        datetime="2026-04-18T19:00:00-04:00"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when datetime is empty', () => {
    const { container } = render(
      <CostCard
        showCostBreakdown={true}
        perPersonCost={11.25}
        datetime=""
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run __tests__/components/CostCard.test.tsx
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `components/CostCard.tsx`:

```tsx
import { fmtDate } from '@/lib/formatters';

export interface CostCardProps {
  showCostBreakdown: boolean | undefined;
  perPersonCost: number | null;
  datetime: string | undefined;
}

export default function CostCard({ showCostBreakdown, perPersonCost, datetime }: CostCardProps) {
  if (!showCostBreakdown) return null;
  if (perPersonCost === null || perPersonCost <= 0) return null;
  if (!datetime) return null;

  return (
    <div className="glass-card p-5 flex items-center justify-between">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Cost per person on {fmtDate(datetime)}
      </p>
      <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
        ${perPersonCost.toFixed(2)}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run __tests__/components/CostCard.test.tsx
```
Expected: PASS (5/5).

- [ ] **Step 5: Full test suite**

Run:
```bash
npm test
```
Expected: all pass (99 total).

- [ ] **Step 6: Commit**

```bash
git add components/CostCard.tsx __tests__/components/CostCard.test.tsx
git commit -m "feat: add CostCard presentational component

Pure render-condition component for per-person session cost.
Extracted from HomeTab inline logic so it can be tested without
mocking HomeTab's fetch/state tree."
```

---

## Task 5: Wire CostCard into HomeTab (remove cost from Announcement)

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Read current HomeTab to locate the regions to change**

Read `components/HomeTab.tsx`. You'll modify two regions:
- **Remove:** The cost block and its comment inside the Announcement card (approximately lines 262–281 — the `{/* Announcement card — also hosts the cost-per-person line... */}` comment through to the closing `</div>` of the cost block).
- **Add:** A `<CostCard />` render above the Announcement card.
- **Add import** at the top: `import CostCard from '@/components/CostCard';`

- [ ] **Step 2: Apply the changes**

Use the Edit tool to:

1. Add the import near other component imports at the top of `components/HomeTab.tsx`:

```tsx
import CostCard from '@/components/CostCard';
```

2. Replace the Announcement-card block so it no longer contains the cost section. The **current** block (around lines 262–283) looks like:

```tsx
{/* Announcement card — also hosts the cost-per-person line when visible.
    Intentional trade-off: if there's no announcement, the cost line is
    hidden too. Keeps a single "club comms" surface instead of two. */}
{effectiveAnnouncement && (
  <div className="glass-card p-5 space-y-2">
    <p className="section-label">ANNOUNCEMENT</p>
    <p className="text-sm text-gray-200 leading-relaxed">{effectiveAnnouncement.text}</p>
    {effectiveSession?.showCostBreakdown && perPersonCost !== null && perPersonCost > 0 && effectiveSession?.datetime && (
      <div
        className="pt-2 mt-2 flex items-center justify-between"
        style={{ borderTop: '1px solid var(--glass-border)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Cost per person on {fmtDate(effectiveSession!.datetime)}
        </p>
        <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
          ${perPersonCost.toFixed(2)}
        </p>
      </div>
    )}
  </div>
)}
```

Replace with a CostCard rendered ABOVE the announcement, and announcement-card with no cost block:

```tsx
{/* Cost per person — standalone card above announcement so cost is
    visible whether or not the admin has posted an announcement. */}
<CostCard
  showCostBreakdown={effectiveSession?.showCostBreakdown}
  perPersonCost={perPersonCost}
  datetime={effectiveSession?.datetime}
/>

{/* Announcement card — pure club communications surface. */}
{effectiveAnnouncement && (
  <div className="glass-card p-5 space-y-2">
    <p className="section-label">ANNOUNCEMENT</p>
    <p className="text-sm text-gray-200 leading-relaxed">{effectiveAnnouncement.text}</p>
  </div>
)}
```

- [ ] **Step 3: Run tests**

Run:
```bash
npm test
```
Expected: all tests pass (99).

- [ ] **Step 4: Manual visual check**

Run `npm run dev`, open `http://localhost:3000/bpm?dev`, and verify:
- With `hasAnnouncement` OFF and cost set: cost card visible, no announcement below.
- With `hasAnnouncement` ON and cost set: cost card above announcement, announcement contains only text.
- With `showCostBreakdown` OFF: no cost card regardless of announcement.
- Dark and light themes both render cleanly.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "feat: move cost above announcement, wire CostCard

Cost per person is now always visible to players when the admin has
set it, independent of whether an announcement has been posted
(addresses user-research finding 4.7)."
```

---

## Task 6: PrevPaymentReminder presentational component (TDD)

**Files:**
- Create: `components/PrevPaymentReminder.tsx`
- Test: `__tests__/components/PrevPaymentReminder.test.tsx`

- [ ] **Step 1: Write failing test**

Create `__tests__/components/PrevPaymentReminder.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PrevPaymentReminder from '../../components/PrevPaymentReminder';

describe('PrevPaymentReminder', () => {
  const baseProps = {
    showCostBreakdown: true,
    prevCostPerPerson: 11.25,
    prevSessionDate: '2026-04-11T19:00:00-04:00',
    hasIdentity: true,
    etransferEmail: 'pay@example.com',
  };

  it('renders cost and e-transfer line when identity exists and prev cost > 0', () => {
    render(<PrevPaymentReminder {...baseProps} />);
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.getByText(/E-transfer to pay@example\.com/)).toBeTruthy();
  });

  it('renders nothing when hasIdentity is false', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} hasIdentity={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when showCostBreakdown is false', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} showCostBreakdown={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is undefined', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} prevCostPerPerson={undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when prevCostPerPerson is zero', () => {
    const { container } = render(
      <PrevPaymentReminder {...baseProps} prevCostPerPerson={0} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('still shows cost line even if etransferEmail is null', () => {
    render(<PrevPaymentReminder {...baseProps} etransferEmail={null} />);
    expect(screen.getByText(/\$11\.25\/person/)).toBeTruthy();
    expect(screen.queryByText(/E-transfer to/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run __tests__/components/PrevPaymentReminder.test.tsx
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write minimal implementation**

Create `components/PrevPaymentReminder.tsx`:

```tsx
import { fmtDate } from '@/lib/formatters';

export interface PrevPaymentReminderProps {
  showCostBreakdown: boolean | undefined;
  prevCostPerPerson: number | undefined;
  prevSessionDate: string | undefined;
  hasIdentity: boolean;
  etransferEmail: string | null;
}

export default function PrevPaymentReminder({
  showCostBreakdown,
  prevCostPerPerson,
  prevSessionDate,
  hasIdentity,
  etransferEmail,
}: PrevPaymentReminderProps) {
  if (!showCostBreakdown) return null;
  if (!hasIdentity) return null;
  if ((prevCostPerPerson ?? 0) <= 0) return null;

  return (
    <div className="mt-3 text-center">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Last session ({prevSessionDate ? fmtDate(prevSessionDate) : '—'}) · ${prevCostPerPerson!.toFixed(2)}/person
      </p>
      {etransferEmail && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          E-transfer to {etransferEmail}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run __tests__/components/PrevPaymentReminder.test.tsx
```
Expected: PASS (6/6).

- [ ] **Step 5: Full test suite**

Run:
```bash
npm test
```
Expected: all pass (105 total).

- [ ] **Step 6: Commit**

```bash
git add components/PrevPaymentReminder.tsx __tests__/components/PrevPaymentReminder.test.tsx
git commit -m "feat: add PrevPaymentReminder presentational component

Extracted from HomeTab inline logic. Gate is hasIdentity (not
isSignedUp) so the reminder persists after session advance — the
moment players most need payment info (research finding 4.8)."
```

---

## Task 7: Wire PrevPaymentReminder into HomeTab with hasIdentity state

**Files:**
- Modify: `components/HomeTab.tsx`

- [ ] **Step 1: Add imports and hasIdentity state**

At the top of `components/HomeTab.tsx` add:

```tsx
import PrevPaymentReminder from '@/components/PrevPaymentReminder';
```

Inside the `HomeTab` function, near the other `useState` declarations (around line 40-50), add:

```tsx
const [hasIdentity, setHasIdentity] = useState(false);
```

In the mount `useEffect` (currently around line 88, which already calls `getIdentity()`), set `hasIdentity` based on the result. Change:

```tsx
useEffect(() => {
  const id = getIdentity();
  if (id) setCurrentUser(id.name);
  loadData();
}, [loadData]);
```

to:

```tsx
useEffect(() => {
  const id = getIdentity();
  setHasIdentity(id !== null);
  if (id) setCurrentUser(id.name);
  loadData();
}, [loadData]);
```

- [ ] **Step 2: Replace inline prev reminder JSX**

Locate the inline prev-reminder block (currently around lines 484–496):

```tsx
{/* Subtle payment reminder for previous session — shown below sign-up card */}
{effectiveSession?.showCostBreakdown && (effectiveSession.prevCostPerPerson ?? 0) > 0 && effectiveIsSignedUp && (
  <div className="mt-3 text-center">
    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
      Last session ({effectiveSession.prevSessionDate ? fmtDate(effectiveSession.prevSessionDate) : '—'}) · ${effectiveSession.prevCostPerPerson!.toFixed(2)}/person
    </p>
    {etransferEmail && (
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
        E-transfer to {etransferEmail}
      </p>
    )}
  </div>
)}
```

Replace with:

```tsx
{/* Payment reminder for previous session — visible whenever the player
    has identity (i.e. has signed up before), not only when signed up
    for the current session. Addresses research finding 4.8. */}
<PrevPaymentReminder
  showCostBreakdown={effectiveSession?.showCostBreakdown}
  prevCostPerPerson={effectiveSession?.prevCostPerPerson}
  prevSessionDate={effectiveSession?.prevSessionDate}
  hasIdentity={hasIdentity}
  etransferEmail={etransferEmail}
/>
```

- [ ] **Step 3: Run tests**

Run:
```bash
npm test
```
Expected: all tests still pass (105).

- [ ] **Step 4: Manual visual check**

Run `npm run dev`, open `http://localhost:3000/bpm?dev`, and verify:
- Dev panel with identity present + prevCost > 0 + signedUp OFF → reminder visible (new behavior).
- Clear localStorage (DevTools → Application → Clear site data), reload → reminder hidden.
- Set identity via sign-up flow → reminder appears after next mount.
- Light/dark theme both render cleanly.

Stop dev server.

- [ ] **Step 5: Final full-suite run**

Run:
```bash
npm test
```
Expected: 105 tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/HomeTab.tsx
git commit -m "feat: persist prev-session payment reminder via hasIdentity gate

Replaces isSignedUp gate with hasIdentity. Players who played last
session but haven't yet signed up for the next one still see cost +
e-transfer details. Uses the new PrevPaymentReminder component."
```

---

## Self-Review

This section is a checklist the plan author (me) runs after writing. Implementers do not need to re-run it.

**Spec coverage:**
- ✅ Cold start splash → Tasks 2 + 3
- ✅ Cost decoupled from announcement → Tasks 4 + 5
- ✅ Prev reminder gated on hasIdentity → Tasks 6 + 7
- ✅ No new API routes, no schema changes — plan avoids them
- ✅ Component tests for all three new presentational components
- ✅ Manual verification steps for splash (only thing not worth unit testing)

**Placeholder scan:** No TBDs. Every step has concrete code or commands. The only "adapt to match" hint is in Task 3 Step 3 for `app/page.tsx` — acceptable because the current structure of that file isn't on record and inserting `<HydrationMark />` must match the real wrapper.

**Type consistency:**
- `CostCardProps` uses `perPersonCost: number | null` — matches HomeTab's `perPersonCost` variable
- `PrevPaymentReminderProps` uses `prevCostPerPerson: number | undefined` — matches Session type's optional field
- `hasIdentity: boolean` consistent across component and HomeTab state

**Commit hygiene:** Each task ends with a single commit. 7 commits total, each independently meaningful.
