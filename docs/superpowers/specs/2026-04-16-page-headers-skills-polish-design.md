# Page Headers + Skills Color Polish Design

**Date:** 2026-04-16
**Topic:** Add page titles to Sign-Up / Learn / Admin (matching Home's `BPM Badminton` style) and reduce green overload in SkillsRadar by swapping informational level text from accent green to primary text color.
**Status:** Design approved verbally. Awaiting spec review.

## Goal

Improve mobile wayfinding and visual balance:
- **Page headers.** Every top-level tab gets a 30px page title so users always know which screen they're on. Home already has one (`BPM Badminton`); Sign-Up, Learn, and Admin do not.
- **Color rebalance.** `SkillsRadar` uses `var(--accent)` (green) as both a semantic signal (selected / rated) and an informational color (current level readout). That overloads the token and visually floods the Learn tab. Demoting the informational uses to `var(--text-primary)` retains the green where it carries meaning (radar polygon, active-state backgrounds, check-circle icon) while quieting the rest of the screen.

## Architecture

Three small, surgical changes:

1. **Each tab component gets an `<h1>` at the top** matching Home's style (`text-3xl font-bold text-gray-200 leading-tight px-2`). Strings go through `useTranslations('pages')` per the C1 framework.
2. **Five color token swaps inside `SkillsRadar.tsx`** — informational level text only. Structural green (polygon, card backgrounds, pill background, check icon) stays.
3. **Three new i18n keys** added to `messages/en.json` and `messages/zh-CN.json` under a new top-level `pages` namespace.

No new components, no new hooks, no layout shifts in Home (already styled correctly). All work is additive or token-level.

## Components touched

### 1. `components/PlayersTab.tsx`

Wrap existing return branches with a page-header div so the `<h1>` renders above the loading / empty / populated states consistently.

```tsx
const t = useTranslations('pages');

// ... all three return branches get wrapped:
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {t('signup.title')}
    </h1>
    <div className="space-y-4">{/* existing content */}</div>
  </div>
);
```

### 2. `components/SkillsTab.tsx`

Same treatment. Header shows in both non-admin (`Progress together?`) and admin (radar + add-player) paths. For the non-admin path, the centered "Progress together?" becomes a tagline below a now-present "Learn" header rather than a floating-alone screen.

```tsx
const t = useTranslations('pages');

// Non-admin branch:
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {t('learn.title')}
    </h1>
    <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 16rem)' }}>
      <p className="text-2xl font-semibold text-center" style={{ color: 'var(--text-muted)' }}>
        Progress together?
      </p>
    </div>
  </div>
);
// (Admin branch wraps its existing space-y-4 the same way.)
```

Note: `minHeight` subtraction nudged from `12rem` → `16rem` to account for the added heading's vertical footprint, so the tagline stays visually centered.

### 3. `components/AdminTab.tsx`

Header renders in all three states (loading skeleton, PIN gate, authed dashboard). Since the authed path dispatches to `<AdminPanel>` → `<AdminDashboard>`, we place the header in `AdminTab`'s outer wrapper so the dashboard internals don't need to know about it.

```tsx
const t = useTranslations('pages');

// Outer wrapper around every state:
return (
  <div className="space-y-5">
    <h1 className="text-3xl font-bold text-gray-200 leading-tight px-2">
      {t('admin.title')}
    </h1>
    {/* loading / PIN gate / dashboard branch */}
  </div>
);
```

The pre-auth PIN gate currently uses `min-h-[60vh]` with vertical centering. We keep that centering but subtract the header height so the gate still reads as "centered below the title" rather than jammed to the top.

### 4. `components/SkillsRadar.tsx` — color token swaps

Five call sites flip from `var(--accent)` (green) to `var(--text-primary)`. All are *informational* text ("your level is X") rather than *semantic* signals ("this one is selected"):

| Line | What | Why it changes |
|---|---|---|
| 254 | Category card level readout: `"3 — Competent"` | Informational. The value is the meaning; green is redundant. |
| 327 | Sheet header skill name: `"Clears"` | The user tapped this category; the sheet itself signals that. Green adds nothing. |
| 398 | Sheet current-level card — player name text | Informational. The surrounding `--inner-card-green-bg/border` already carries "this is your current level". |
| 405 | Sheet current-level card — level pill text (`"3 — Competent"`) | Informational. The subtle pill background tint still reads as a badge without green text. |
| 444, 451 | Sheet "All Levels" active row — level number + name | The `isActive` conditional flip from `--text-muted` → `--text-primary` (instead of `--accent`) is enough to distinguish the active row. |

**Preserved green (semantic / structural):**
- Line 205–209: radar polygon stroke + fill (`#4ade80`) — this IS the player's skill profile visualization, the most green-appropriate element on the page.
- Line 393–394, 491–492: `--inner-card-green-bg` / `--inner-card-green-border` backgrounds on current-level and edit-active cards — subtle tint carrying "this is the one".
- Line 404: level pill background (`rgba(74, 222, 128, 0.2)`) — subtle badge tint; only the pill text flips.
- Line 503–504: check-circle icon in `EditContent` — universal "selected" affordance.

### 5. `messages/en.json`

Add new top-level `pages` namespace. Three keys:

```json
"pages": {
  "signup": { "title": "Sign-Up" },
  "learn": { "title": "Learn" },
  "admin": { "title": "Admin" }
}
```

### 6. `messages/zh-CN.json`

```json
"pages": {
  "signup": { "title": "报名" },
  "learn": { "title": "学习" },
  "admin": { "title": "管理" }
}
```

`报名` matches the existing `home.signup.heading` in zh-CN for consistency. `学习` (learning) reads naturally for the Learn tab. `管理` (management) is the conventional short form for an admin surface.

## Testing

1. **Canary-strings test** (`__tests__/i18n/canary-strings.test.tsx`): extend the parametric table to include the 3 new keys. Existing 14 → 17.
2. **Component tests** (new file `__tests__/components/PageHeaders.test.tsx`): 3 tests, one per tab, render each tab inside an `NextIntlClientProvider` wrapper and assert the `<h1>` text.
3. **SkillsRadar color characterization test** (extend `__tests__/components/SkillsRadar.test.tsx`): assert the category card level text does NOT use `color: var(--accent)` (inline style match or computed-style snapshot). Adds one test.

Target on green: 194 → 198 tests.

## Error handling

None required. All work is additive; no new failure modes. Translation fallback to English is already in place via `i18n/request.ts` deep-merge, so a missing `zh-CN` key can't break render.

## Consistency notes / deferred items

- **Bottom nav vs page header wording**: The bottom nav labels are `Home / Sign-Ups / Coming Soon / Admin`. The new page headers are `BPM Badminton / Sign-Up / Learn / Admin`. Two small inconsistencies:
  - `Sign-Ups` (plural, bottom nav) vs `Sign-Up` (singular, page header). User chose singular for the header.
  - `Coming Soon` (bottom nav, both admin and non-admin) vs `Learn` (page header). The bottom nav is stale — admins do get a real Skills tab. Updating the bottom nav is out of scope here; flagged for a follow-up.
- **AdminTab 5-tap easter egg**: Only Home's header carries the `onTitleTap` handler. The Admin header does NOT — tapping it 5 times does nothing. Users who need admin access already have it or are being granted it via the Home easter egg path.
- **Learn-tab empty-state spacing**: The `minHeight` subtraction (12rem → 16rem) is approximate; the exact value may need a small visual nudge after the implementation, but the centering principle holds.

## Out of scope

- Redesigning Sign-Up / Learn / Admin page bodies (only headers are added; everything below is unchanged).
- Updating the bottom-nav labels to match the page headers (separate concern).
- Changing the radar polygon color or any other semantic green usage.
- Adding hover / tap affordances to the new headers (Home's header is also visually static except for the easter egg).

## Open questions

None. All verbal approvals captured:
- Option B (tab-specific page titles) confirmed.
- AdminTab header above centered PIN gate confirmed.
- Color recommendations (just #1, #3, #5 of the green-list; keep #2, #4, #6; use `var(--text-primary)`) confirmed.
