# Page Headers + Skills Color Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page titles to Sign-Up / Learn / Admin tabs matching Home's BPM Badminton style, and demote informational green in SkillsRadar to primary text color to reduce the green overload on the Learn tab.

**Architecture:** Three small surgical changes: (1) add `<h1>` at the top of each non-Home tab wired to new `pages.{signup,learn,admin}.title` i18n keys, (2) five `var(--accent)` → `var(--text-primary)` swaps in SkillsRadar (informational level text only — radar polygon, card tints, pill background, check-circle stay green), (3) new i18n keys added to en.json and zh-CN.json. All work is additive at the component level; no new files besides two new test files.

**Tech Stack:** Next.js 16 App Router, React 18, TypeScript, next-intl v4, Tailwind, Vitest + @testing-library/react + jsdom.

---

## File structure

**Modified:**
- `messages/en.json` — add `pages.{signup,learn,admin}.title` keys.
- `messages/zh-CN.json` — add same keys with Chinese values.
- `components/PlayersTab.tsx` — wrap all return branches in a div with `<h1>`.
- `components/SkillsTab.tsx` — wrap both return branches in a div with `<h1>`; nudge non-admin `minHeight` from `12rem` to `16rem`.
- `components/AdminTab.tsx` — wrap all three states (loading / PIN gate / authed) in a div with `<h1>`.
- `components/SkillsRadar.tsx` — five `var(--accent)` → `var(--text-primary)` swaps.
- `__tests__/i18n/canary-strings.test.tsx` — add three new keys to `CANARY_KEYS`.

**Created:**
- `__tests__/components/PageHeaders.test.tsx` — three tests asserting each tab renders its page title.
- `__tests__/components/SkillsRadar.test.tsx` — one test asserting the category card level text uses primary color, not accent.

---

## Task 1: Add i18n keys and extend canary test

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`
- Modify: `__tests__/i18n/canary-strings.test.tsx:8-20`

- [ ] **Step 1: Extend the canary key array and the zh-CN drift assertion**

Open `__tests__/i18n/canary-strings.test.tsx`. Add three new keys to the `CANARY_KEYS` tuple so the test expects them to exist in both locale files and to differ between English and Chinese.

Replace the existing `CANARY_KEYS` block (lines 8-20) with:

```tsx
const CANARY_KEYS = [
  'home.signup.button',
  'home.signup.waitlist',
  'home.signup.full',
  'home.signup.confirmed',
  'home.cost.label',
  'home.cost.emphasis',
  'home.session.date',
  'home.session.when',
  'home.roster.count',
  'home.payment.reminder',
  'home.payment.etransfer',
  'pages.signup.title',
  'pages.learn.title',
  'pages.admin.title',
] as const;
```

Also update the describe block's label from `'canary messages — all 11 keys exist in both locales'` to `'canary messages — all 14 keys exist in both locales'` (line 31).

- [ ] **Step 2: Run the test to confirm failure**

Run: `npx vitest run __tests__/i18n/canary-strings.test.tsx`

Expected: FAIL — six new assertions (3 keys × 2 locales) each report `expected string, got undefined`, plus the drift assertion fails because both locales return `undefined` for the new keys.

- [ ] **Step 3: Add the English keys**

Open `messages/en.json`. After the closing `}` of the `"home"` object (which ends at the line with `"admin": {`), keep the existing `"admin"` object. We're adding a new top-level `"pages"` sibling. Transform the file so the top-level object contains `home`, `pages`, `admin` in that order.

Concretely, locate the closing `}` of the `"home"` block (the line immediately before `"admin": {`) and insert the new `"pages"` block between `"home"` and `"admin"`. The resulting file should look like:

```json
{
  "home": {
    "...existing home keys unchanged...": ""
  },
  "pages": {
    "signup": { "title": "Sign-Up" },
    "learn": { "title": "Learn" },
    "admin": { "title": "Admin" }
  },
  "admin": {
    "releases": {
      "newButton": "New release",
      "draftWithAI": "Draft with AI",
      "publish": "Publish"
    }
  }
}
```

Keep every existing key inside `home` and `admin` untouched.

- [ ] **Step 4: Add the Chinese keys**

Open `messages/zh-CN.json` and add the same `"pages"` sibling at the top level, between `"home"` and `"admin"`:

```json
"pages": {
  "signup": { "title": "报名" },
  "learn": { "title": "进阶技能" },
  "admin": { "title": "管理" }
}
```

Keep every existing key in the file untouched.

- [ ] **Step 5: Run the canary test to confirm pass**

Run: `npx vitest run __tests__/i18n/canary-strings.test.tsx`

Expected: PASS — all 14 keys found in both locales, all 14 zh-CN strings differ from their English counterparts. The render tests (en + zh-CN) should also pass for the 3 new keys since they're plain static strings.

- [ ] **Step 6: Commit**

```bash
git add messages/en.json messages/zh-CN.json __tests__/i18n/canary-strings.test.tsx
git commit -m "feat: add pages.{signup,learn,admin}.title i18n keys

Extends the canary bundle from 11 → 14 keys. zh-CN translations:
报名 / 进阶技能 / 管理. 进阶技能 ('advance skills') frames the Learn
tab as skill progression rather than generic learning, matching
the ACE skills framework the tab is built around.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add page header to PlayersTab

**Files:**
- Create: `__tests__/components/PageHeaders.test.tsx`
- Modify: `components/PlayersTab.tsx`

- [ ] **Step 1: Write the failing PlayersTab header test**

Create `__tests__/components/PageHeaders.test.tsx` with this content:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import PlayersTab from '../../components/PlayersTab';
import enMessages from '../../messages/en.json';

describe('PageHeaders', () => {
  beforeEach(() => {
    // Stub fetch so tabs that fire requests in useEffect don't hit the network.
    // A never-resolving promise keeps the component in its initial state so we
    // can assert on the header without waiting for async data.
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('PlayersTab renders "Sign-Up" as an h1', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlayersTab />
      </NextIntlClientProvider>
    );
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Sign-Up');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: FAIL — `Unable to find an accessible element with the role "heading" and level "1"`. PlayersTab currently has no `<h1>`.

- [ ] **Step 3: Add the header to PlayersTab**

Open `components/PlayersTab.tsx`. Make three changes:

**3a.** Add `useTranslations` to the imports at the top:

```tsx
import { useTranslations } from 'next-intl';
```

**3b.** Inside the component (right after `export default function PlayersTab() {`), add the translations hook as the first line of the function body:

```tsx
const pageT = useTranslations('pages.signup');
```

**3c.** Refactor the three return branches so each is wrapped in a parent `<div className="space-y-5">` with the `<h1>` at the top. Find the loading branch (around line 65: `return <ShuttleLoader text="Loading players..." />;`), the empty-state branch (around line 72), and the populated branch (around line 82) and wrap each.

Replace the loading branch:

```tsx
if (loading) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <ShuttleLoader text="Loading players..." />
    </div>
  );
}
```

Replace the empty-state branch:

```tsx
if (activePlayers.length === 0 && waitlistPlayers.length === 0) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <div className="glass-card p-10 text-center">
        <span className="material-icons block mb-2 text-gray-500" style={{ fontSize: 36, opacity: 0.25 }}>sports_tennis</span>
        <p className="text-gray-500 text-sm">No one&apos;s signed up yet — be the first!</p>
      </div>
    </div>
  );
}
```

Replace the populated branch's outer wrapper — change `<div className="space-y-4">` to a wrapper with the header, keeping the inner `space-y-4` so active/waitlist cards retain their 4-unit spacing:

```tsx
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {pageT('title')}
    </h1>
    <div className="space-y-4">
      {/* ...existing active-players card, waitlist card, cancel button — all unchanged... */}
    </div>
  </div>
);
```

- [ ] **Step 4: Run the test to verify pass**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: PASS — the `<h1>` with text "Sign-Up" renders in the loading state (the stubbed fetch never resolves, so `loading` stays true).

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `npm test`

Expected: All tests pass (195/195, up from 194 by +1 for the new PageHeaders test).

- [ ] **Step 6: Commit**

```bash
git add components/PlayersTab.tsx __tests__/components/PageHeaders.test.tsx
git commit -m "feat: add Sign-Up page header to PlayersTab

Matches Home's BPM Badminton style (text-3xl text-gray-200 px-2).
Renders in all three branches (loading / empty / populated). Strings
come from the new pages.signup.title i18n key.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add page header to SkillsTab

**Files:**
- Modify: `__tests__/components/PageHeaders.test.tsx`
- Modify: `components/SkillsTab.tsx`

- [ ] **Step 1: Add failing SkillsTab tests (admin + non-admin)**

Add these imports at the top of `__tests__/components/PageHeaders.test.tsx`:

```tsx
import SkillsTab from '../../components/SkillsTab';
```

Inside the existing `describe('PageHeaders', ...)` block, after the PlayersTab test, add:

```tsx
it('SkillsTab (non-admin) renders "Learn" as an h1', () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SkillsTab isAdmin={false} />
    </NextIntlClientProvider>
  );
  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading.textContent).toBe('Learn');
});

it('SkillsTab (admin) renders "Learn" as an h1', () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SkillsTab isAdmin={true} />
    </NextIntlClientProvider>
  );
  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading.textContent).toBe('Learn');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: FAIL on both new tests — `Unable to find an accessible element with the role "heading" and level "1"`.

- [ ] **Step 3: Add the header to SkillsTab**

Open `components/SkillsTab.tsx`. Make these changes:

**3a.** Add `useTranslations` to imports:

```tsx
import { useTranslations } from 'next-intl';
```

**3b.** Inside the component (right after `export default function SkillsTab({ isAdmin }: { isAdmin?: boolean }) {`), add the hook as the first line:

```tsx
const pageT = useTranslations('pages.learn');
```

**3c.** Define an inline `PageHeader` constant and wrap both return branches. Replace the non-admin branch (around line 81) with:

```tsx
if (!isAdmin) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <div
        className="flex items-center justify-center"
        style={{ minHeight: 'calc(100vh - 16rem)' }}
      >
        <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
          Progress together?
        </p>
      </div>
    </div>
  );
}
```

Note: `minHeight` subtracts `16rem` instead of the original `12rem` to account for the header's height plus spacing, so "Progress together?" still reads as vertically centered.

**3d.** For the admin / loading / populated branch (starting around line 93: `if (loading) return <ShuttleLoader ... />;`), wrap the same way. Replace the final `return (<div className="space-y-4">...)` with:

```tsx
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {pageT('title')}
    </h1>
    <div className="space-y-4">
      {/* ...existing SkillsRadar / empty prompt / Add Player form... */}
    </div>
  </div>
);
```

And the loading branch (replace `return <ShuttleLoader text="Loading skills..." />;`):

```tsx
if (loading) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <ShuttleLoader text="Loading skills..." />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: PASS — both SkillsTab tests now find an h1 with text "Learn". (Non-admin renders immediately; admin renders the loading state because `fetch` hangs.)

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: 197/197 tests pass (+2 new SkillsTab tests).

- [ ] **Step 6: Commit**

```bash
git add components/SkillsTab.tsx __tests__/components/PageHeaders.test.tsx
git commit -m "feat: add Learn page header to SkillsTab

Header renders in both admin and non-admin branches plus the loading
state. Non-admin minHeight subtracted 16rem (was 12rem) so the
'Progress together?' tagline stays visually centered below the new
header.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add page header to AdminTab

**Files:**
- Modify: `__tests__/components/PageHeaders.test.tsx`
- Modify: `components/AdminTab.tsx`

- [ ] **Step 1: Add failing AdminTab test**

Add to `__tests__/components/PageHeaders.test.tsx`:

```tsx
import AdminTab from '../../components/AdminTab';
```

And inside the existing `describe('PageHeaders', ...)` block:

```tsx
it('AdminTab renders "Admin" as an h1', () => {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AdminTab />
    </NextIntlClientProvider>
  );
  const heading = screen.getByRole('heading', { level: 1 });
  expect(heading.textContent).toBe('Admin');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: FAIL — `Unable to find an accessible element with the role "heading" and level "1"` for AdminTab.

Note: The h2 text `"Admin Access"` inside the PIN gate is a level-2 heading, so `getByRole('heading', { level: 1 })` will not match it.

- [ ] **Step 3: Add the header to AdminTab**

Open `components/AdminTab.tsx`. Changes:

**3a.** Add `useTranslations` to imports:

```tsx
import { useTranslations } from 'next-intl';
```

**3b.** Inside `AdminTab()` (after the existing `useState`/`useEffect` hooks, before the early returns), add:

```tsx
const pageT = useTranslations('pages.admin');
```

**3c.** Wrap all three return paths. Replace:

```tsx
if (isAuthed === null) {
  return <ShuttleLoader />;
}
```

with:

```tsx
if (isAuthed === null) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <ShuttleLoader />
    </div>
  );
}
```

Replace the PIN-gate block (currently `if (!isAuthed) { return (<div className="flex items-center justify-center min-h-[60vh]">...)`) with:

```tsx
if (!isAuthed) {
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
        {pageT('title')}
      </h1>
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="glass-card p-6 w-full max-w-xs space-y-5">
          <div className="text-center">
            <span className="material-icons icon-xl text-green-400">lock</span>
            <h2 className="text-lg font-bold text-green-400 mt-2">Admin Access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Enter your PIN to continue</p>
          </div>
          <form onSubmit={handlePinSubmit} className="space-y-3">
            <input
              id="admin-pin"
              name="pin"
              type="password"
              placeholder="PIN"
              aria-label="Admin PIN"
              aria-describedby={pinError ? 'pin-error' : undefined}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={10}
              inputMode="numeric"
              autoFocus
            />
            {pinError && <p id="pin-error" role="alert" className="text-xs text-red-400">{pinError}</p>}
            <button
              type="submit"
              disabled={checking || !pin}
              className="btn-primary w-full"
            >
              {checking ? 'Checking\u2026' : 'Enter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

Note: `min-h-[60vh]` → `min-h-[50vh]` so the PIN card doesn't get pushed off-screen by the added header.

Replace the authed return (`return <AdminPanel onLogout={handleLogout} />;`) with:

```tsx
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {pageT('title')}
    </h1>
    <AdminPanel onLogout={handleLogout} />
  </div>
);
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run __tests__/components/PageHeaders.test.tsx`

Expected: PASS — the h1 "Admin" renders in the loading state (`isAuthed === null`) because the stubbed fetch never resolves.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: 198/198 tests pass (+1 AdminTab test).

- [ ] **Step 6: Commit**

```bash
git add components/AdminTab.tsx __tests__/components/PageHeaders.test.tsx
git commit -m "feat: add Admin page header to AdminTab

Header wraps all three states (loading / PIN gate / authed dashboard)
from the outer component so AdminDashboard internals don't need to
know about it. PIN-gate min-h reduced from 60vh to 50vh so the gate
still fits below the header on short viewports.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: SkillsRadar color swaps (reduce green overload)

**Files:**
- Create: `__tests__/components/SkillsRadar.test.tsx`
- Modify: `components/SkillsRadar.tsx`

- [ ] **Step 1: Write failing color test**

Create `__tests__/components/SkillsRadar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SkillsRadar, { type PlayerSkills } from '../../components/SkillsRadar';

// Mock recharts so we don't try to render SVG in jsdom. We only care about
// the non-chart DOM (category cards, sheet text, etc.).
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass,
    RadarChart: Pass,
    PolarGrid: () => null,
    PolarAngleAxis: () => null,
    PolarRadiusAxis: () => null,
    Radar: () => null,
  };
});

const sample: PlayerSkills[] = [
  {
    id: 'p1',
    name: 'Kevin',
    scores: {
      'grip-stroke': 3,
      'footwork': 2,
      'serve-return': 4,
      'net-play': 3,
      'clears-drops': 2,
      'game-sense': 3,
    },
  },
];

describe('SkillsRadar — green rebalance', () => {
  afterEach(cleanup);

  it('category card level text uses primary color, not accent green', () => {
    render(<SkillsRadar players={sample} />);
    // The category cards render a button per skill dimension with two <p> tags:
    // the dimension name and the level readout ("3 — Competent" or "Not rated").
    // We assert the level readout's inline style uses var(--text-primary),
    // not var(--accent), per the 2026-04-16 green-rebalance spec.
    const levelTexts = screen.getAllByText(/—|Not rated/);
    expect(levelTexts.length).toBeGreaterThan(0);
    const first = levelTexts[0]!;
    const styleAttr = first.getAttribute('style') ?? '';
    expect(styleAttr).not.toContain('var(--accent)');
    expect(styleAttr).toContain('var(--text-primary)');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run __tests__/components/SkillsRadar.test.tsx`

Expected: FAIL — the test finds the level text, but its inline style currently contains `var(--accent)`, not `var(--text-primary)`.

- [ ] **Step 3: Apply the five color swaps in SkillsRadar.tsx**

Open `components/SkillsRadar.tsx` and change these five call sites:

**Swap 1 (line ~254) — category card level readout:**

Change:
```tsx
<p className="text-sm font-bold mt-1" style={{ color: 'var(--accent)' }}>
  {score > 0 ? `${score} — ${levelName}` : 'Not rated'}
</p>
```

To:
```tsx
<p className="text-sm font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
  {score > 0 ? `${score} — ${levelName}` : 'Not rated'}
</p>
```

**Swap 2 (line ~327) — sheet header skill name:**

Change:
```tsx
<h2 className="text-lg font-bold" style={{ color: 'var(--accent)' }}>
  {dim.name}
</h2>
```

To:
```tsx
<h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
  {dim.name}
</h2>
```

**Swap 3 (line ~398) — sheet current-level card player name:**

Change:
```tsx
<span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
  {playerName}
</span>
```

To:
```tsx
<span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
  {playerName}
</span>
```

**Swap 4 (line ~405) — sheet current-level pill text:**

Change:
```tsx
<span
  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
  style={{
    background: 'rgba(74, 222, 128, 0.2)',
    color: 'var(--accent)',
  }}
>
  {score} — {levelName}
</span>
```

To:
```tsx
<span
  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
  style={{
    background: 'rgba(74, 222, 128, 0.2)',
    color: 'var(--text-primary)',
  }}
>
  {score} — {levelName}
</span>
```

Note: the green pill *background* stays; only the text color flips.

**Swap 5 (lines ~444 and ~451) — "All Levels" active row:**

Change:
```tsx
<span
  className="text-sm font-bold shrink-0 mt-0.5"
  style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', width: 14 }}
>
  {l.level}
</span>
<div className="min-w-0">
  <span
    className="text-sm font-semibold"
    style={{ color: isActive ? 'var(--accent)' : 'var(--text-secondary)' }}
  >
    {l.name} —{' '}
  </span>
```

To:
```tsx
<span
  className="text-sm font-bold shrink-0 mt-0.5"
  style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)', width: 14 }}
>
  {l.level}
</span>
<div className="min-w-0">
  <span
    className="text-sm font-semibold"
    style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
  >
    {l.name} —{' '}
  </span>
```

**Do NOT change** these green elements (they carry semantic meaning):
- Lines ~205–209: `stroke="#4ade80" fill="#4ade80"` on the `<Radar>` — player's skill polygon.
- Lines ~393–394: `background: 'var(--inner-card-green-bg)'` + `border: 'var(--inner-card-green-border)'` on the current-level card wrapper.
- Line ~404: `background: 'rgba(74, 222, 128, 0.2)'` on the pill — only its text flips.
- Lines ~491–492: same green bg/border tokens on the Edit-view active tap button.
- Line ~498: `color: 'var(--accent)'` on the edit-mode active level label — this is the "currently tapped" indicator inside an editing surface, NOT the informational level readout in view mode. Keep green here; otherwise the user has no visual signal which level they're committing to.
- Lines ~503–504: `color: 'var(--accent)'` on the `check_circle` material-icons span — universal "selected" affordance.

- [ ] **Step 4: Run the color test to verify pass**

Run: `npx vitest run __tests__/components/SkillsRadar.test.tsx`

Expected: PASS — the category card level text's inline style no longer contains `var(--accent)` and now contains `var(--text-primary)`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: 199/199 tests pass (+1 SkillsRadar color test).

- [ ] **Step 6: Commit**

```bash
git add components/SkillsRadar.tsx __tests__/components/SkillsRadar.test.tsx
git commit -m "feat: demote informational green in SkillsRadar

Five var(--accent) → var(--text-primary) swaps on informational level
text (category card readout, sheet header skill name, current-level
card player name + pill text, 'All Levels' active row). Structural
green preserved: radar polygon, --inner-card-green-bg/border tints,
pill background tint, check-circle icon, edit-mode active level label.

Reduces the 'too much green' overload on the Learn tab without
losing the semantic green that distinguishes selected / current /
rated states.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Manual visual smoke test and final verification

**Files:**
- No code changes. Document the verification steps performed.

- [ ] **Step 1: Start the dev server in the worktree**

Run from the worktree root:

```bash
npm run dev
```

Wait for the `Ready` line. Open `http://localhost:3000/bpm` in a browser.

- [ ] **Step 2: Verify page headers in both locales and themes**

For **each** of the four theme/locale combinations (light-en, dark-en, light-zh, dark-zh), verify:

- Home tab: `BPM Badminton` still renders as the 30px h1 at top (should be unchanged).
- Sign-Ups tab: new heading `Sign-Up` / `报名` renders at the top, same size and style as Home.
- Skills tab (non-admin): new heading `Learn` / `进阶技能` at top; `Progress together?` tagline still visible, roughly centered in the remaining space.
- Admin tab (pre-auth): new heading `Admin` / `管理` at top; PIN gate card centered below.

Use the language toggle (right-side floating globe icon) to flip locales and the theme toggle to flip light/dark.

- [ ] **Step 3: Verify SkillsRadar green rebalance**

Ensure you have admin access. Open the Skills tab:

- Each of the 6 category cards shows `N — LevelName` in white/near-black text (not green).
- Tap a category → sheet opens. Header text (skill name) is white, not green.
- Current-level card player name is white, not green.
- Pill badge `"3 — Competent"` has white text on the subtle green background.
- "All Levels" list: the active row's number + name is white, not green.
- The radar polygon itself is still green (this is intentional).
- Edit mode: tapping a level still shows a green check-circle + green level label on the active button (intentional — this is the "committing" indicator).

Flip to light mode and repeat — text should resolve to near-black via `var(--text-primary)`.

- [ ] **Step 4: Run the full test suite one last time**

Run: `npm test`

Expected: 199/199 tests pass, no failures.

- [ ] **Step 5: Stop the dev server**

Press `Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 6: Commit nothing — this task is verification only**

If any of the above steps surfaced a bug, stop here and fix before proceeding. If all green, continue to the finishing-a-development-branch workflow to push the branch and open the PR.

---

## Self-review summary

**Spec coverage** — every requirement in `2026-04-16-page-headers-skills-polish-design.md` maps to a task:

| Spec section | Implementing task |
|---|---|
| Page header on PlayersTab | Task 2 |
| Page header on SkillsTab (both branches) | Task 3 |
| Page header on AdminTab (all branches) | Task 4 |
| 5 color swaps in SkillsRadar | Task 5 |
| `pages.{signup,learn,admin}.title` in en.json | Task 1 |
| `pages.{signup,learn,admin}.title` in zh-CN.json | Task 1 |
| Extend canary test | Task 1 |
| PageHeaders.test.tsx | Tasks 2, 3, 4 |
| SkillsRadar color characterization test | Task 5 |
| Visual verification in both themes + locales | Task 6 |

**Type / name consistency** — all tasks use the same i18n namespace pattern (`useTranslations('pages.<tab>')`), same h1 classes (`text-3xl font-bold text-gray-200 leading-tight px-2`), same outer wrapper (`<div className="space-y-5">`), and the same test pattern (fetch stub + `getByRole('heading', { level: 1 })`). No name drift.

**Bite-sized granularity** — each task has 5-6 steps, each 2-5 minutes. RED → GREEN → commit per task.

**Out of scope (not in any task, per spec):**
- Updating bottom-nav labels to match page headers (deferred).
- Changing the radar polygon color or any semantic green.
- Redesigning Sign-Up / Learn / Admin page bodies.
