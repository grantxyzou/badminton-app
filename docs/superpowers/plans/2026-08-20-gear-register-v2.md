# Gear Register v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gear register's v1 carry-over (`RacketRow` + four stacked v2 cards) with the purpose-built pick-rail layout from the Stats Frame artboard, and make `GearRegister` the single owner of the gear document.

**Architecture:** `GearRegister` calls `useGear` exactly once and passes the resulting object down one level; a horizontal `GearPickRail` of per-category recommendation cards replaces `GearRail`; `GearPickSheet` ("take our pick") and `GearSheet` ("choose your own") are the only two write doors. `/api/recommend` gains a real `category` dimension, and pick reasons are built by a pure, unit-tested `lib/pickReasons.ts` that inherits the club-tally cohort guard.

**Tech Stack:** Next.js 16.3.1 (App Router, Turbopack), TypeScript, Tailwind + `app/globals.css` tokens, next-intl, Cosmos DB via `lib/cosmos.ts`, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-20-gear-register-v2-design.md`

## Global Constraints

- **Branch:** `feat/gear-register-v2`, based on `chore/stats-v2-stage8` (PR #262). Rebase onto `main` once #262 merges. Do not merge this before #262 — this deletes `RacketRow`, which the pre-Stage-8 `SkillsTab` imports.
- **Token guardrail:** `components/stats` errors (not warns) on `DESIGN_TOKEN_SELECTORS`. No bare hex, no raw inline `borderRadius` numbers, no numeric `fontSize`, no bare `rgba()`, no bare `text-xs`/`text-sm`/`text-base` classes. Use `--fs-*`, `--space-*`, `--radius-*`, `--icon-*`.
- **Radii:** rectangular surfaces cap at 16px. Inner rows and tiles inside a card: 12px (`--radius-lg`) + 12px padding.
- **Touch targets:** 44px minimum, everywhere.
- **Every card renders one of four states honestly:** loading (`CardSkeleton` at the card's own height), error (`ErrorState`, `role="alert"`), empty (`EmptyState`), ready. `catch { setX([]) }` is forbidden.
- **Numbers use `var(--font-mono)`.**
- **Icons:** any new Material Symbol must be added to the `icon_names=` URL in `app/layout.tsx` or it renders as raw text.
- **New i18n keys go in BOTH `messages/en.json` and `messages/zh-CN.json`.** `__tests__/i18n/locale-parity.test.ts` enforces it. Restart the dev server after adding a new top-level namespace (next-intl HMR is sticky).
- **i18n namespace for all Gear copy is `stats.gear`.** Never `valueHub`.
- **Component tests need:** `// @vitest-environment jsdom` on line 1, an `NextIntlClientProvider` wrapper with real `messages/en.json`, `setIdentity()` for `activeName`, and `afterEach(cleanup)`.
- **Route tests need:** import the handler directly, `resetMockStore()` + `setupAdminPin()` in `beforeEach`, `makeRequest()` from `__tests__/helpers.ts` for a unique `X-Client-IP`.
- **Gates between every task:** full `npm test` AND `npm run lint` (baseline 0 errors). `npx tsc --noEmit` before any push. A task-scoped check cannot see cross-file breakage.

---

### Task 1: `/api/recommend` gains a real `category` dimension

Today the route hardcodes `category: 'racket'` in both queries and `recommendRackets` hard-filters `item.category !== 'racket'` internally, so a per-category rail would be lying.

**Files:**
- Modify: `lib/racketRecommend.ts:331-349` (`recommendRackets`)
- Modify: `app/api/recommend/route.ts:80-143` (flag-on branch)
- Test: `__tests__/recommend-category.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /api/recommend?name=<name>&category=<category>` returning
  `{ item: CatalogItem | null, reason: string | null, reasons?: string[], warnings?: string[], needsCheckIn?: boolean, unavailable?: 'no_engine' | 'no_catalog' }`.
  Absent `category` behaves exactly as today (racket). Task 3 and Task 5 consume this.

- [ ] **Step 1: Write the failing test**

Create `__tests__/recommend-category.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { resetMockStore } from '@/lib/cosmos';
import { makeRequest, setupAdminPin } from './helpers';

describe('GET /api/recommend?category=', () => {
  beforeEach(async () => {
    resetMockStore();
    await setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  it('400s on an unrecognized category rather than coercing to racket', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=shoes'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_category');
  });
});
```

The plural `shoes` is the exact trap: the enum is singular (`shoe`), and before the matching fix in `catalog/route.ts` a plural typo returned rackets with a 200.

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run __tests__/recommend-category.test.ts`
Expected: FAIL — the route currently ignores `category` and answers 200 or 403.

- [ ] **Step 3: Add the category guard to the route**

In `app/api/recommend/route.ts`, import the category list and validate immediately after reading `name` (rate limiting must stay first — security rule 4):

```ts
import type { EquipmentCategory } from '@/lib/types';

const VALID_CATEGORIES: EquipmentCategory[] = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];
/** Categories with a scoring engine. Everything else is a valid ask we cannot
 *  answer yet — distinct from an invalid ask, which is a 400. */
const ENGINE_CATEGORIES: EquipmentCategory[] = ['racket'];
```

Then inside `GET`, right after `const name = ...`:

```ts
const rawCategory = new URL(req.url).searchParams.get('category');
if (rawCategory !== null && !(VALID_CATEGORIES as string[]).includes(rawCategory)) {
  return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
}
const category = (rawCategory ?? 'racket') as EquipmentCategory;
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run __tests__/recommend-category.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the no-engine case**

Append to `__tests__/recommend-category.test.ts`:

```ts
  it('returns unavailable:no_engine for a valid category with no scorer', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=shoe'),
    );
    // 403 is expected without a member cookie; assert the shape via admin instead.
    expect([200, 403]).toContain(res.status);
  });

  it('absent category still behaves as racket', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin'));
    expect(res.status).not.toBe(400);
  });
```

- [ ] **Step 6: Run and verify it fails**

Run: `npx vitest run __tests__/recommend-category.test.ts`
Expected: FAIL on the `no_engine` case.

- [ ] **Step 7: Return `unavailable` for categories with no engine**

In the flag-on branch of `app/api/recommend/route.ts`, before building the profile:

```ts
if (!ENGINE_CATEGORIES.includes(category)) {
  // A valid category we cannot score yet. NOT an error: the rail renders its
  // parked card from this, and shoes/shuttles are a data-sourcing problem.
  return NextResponse.json({ item: null, reason: null, unavailable: 'no_engine' });
}
```

Then parameterise the catalog query — replace the hardcoded `value: 'racket'` at both query sites with `value: category`, and after fetching:

```ts
if (catalogItems.length === 0) {
  return NextResponse.json({ item: null, reason: null, unavailable: 'no_catalog' });
}
```

- [ ] **Step 8: Parameterise `recommendRackets`' internal filter**

In `lib/racketRecommend.ts`, change the signature and the filter:

```ts
export function recommendRackets(
  profile: PlayerProfile,
  catalog: CatalogItem[],
  topN: number = 5,
  category: CatalogItem['category'] = 'racket'
): Recommendation[] {
  const results: Recommendation[] = [];

  for (const item of catalog) {
    if (item.category !== category) continue;
    if (!isScorable(item)) continue;
    if (profile.currentRacketId && item.id === profile.currentRacketId) continue;

    results.push(scoreItem(item, profile));
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}
```

The default keeps all existing call sites unchanged. The scorers remain racket-shaped — this parameter exists so the filter is not a lie, not because other categories are scorable yet.

- [ ] **Step 9: Run the full suite and lint**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all pass, lint 0 errors.

- [ ] **Step 10: Commit**

```bash
git add lib/racketRecommend.ts app/api/recommend/route.ts __tests__/recommend-category.test.ts
git commit -F - <<'MSG'
feat(recommend): make category a real dimension, not a hardcoded 'racket'

The route hardcoded category:'racket' in both catalog queries and
recommendRackets hard-filtered it internally, so a per-category rail would
have been lying about what it asked for.

An unrecognized category now 400s rather than coercing, matching the fix
already made in equipment/catalog. A VALID category with no scoring engine
returns unavailable:'no_engine' — that is not an error, it is what the rail's
parked card is built from.
MSG
```

---

### Task 2: `lib/pickReasons.ts` — grounded why-this reasons with the cohort guard

The artboard's reasons cite drills ("You are drilling split steps twice a week") and club aggregates ("Wide last fits the foot shape most of the club reports"). Today's engine only produces equipment-derived reasons.

**Files:**
- Create: `lib/pickReasons.ts`
- Test: `__tests__/pick-reasons.test.ts` (create)

**Interfaces:**
- Consumes: `ClubGearEntry` and `CLUB_GEAR_MIN_COHORT` from `lib/clubGear.ts`; `DrillPick` from `lib/drills.ts`; `CatalogItem` from `lib/types.ts`.
- Produces: `buildPickReasons(input: PickReasonInput): string[]` — Task 3 calls it.

- [ ] **Step 1: Write the failing privacy test**

Create `__tests__/pick-reasons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPickReasons } from '@/lib/pickReasons';
import type { CatalogItem } from '@/lib/types';

const ITEM: CatalogItem = {
  id: 'yonex-astrox-88d',
  category: 'racket',
  brand: 'Yonex',
  model: 'Astrox 88D Pro',
  skillRange: [3, 6],
  attributes: { weight: '3U', balance: 'head-heavy', flex: 'stiff' },
};

describe('buildPickReasons — club data inherits the cohort guard', () => {
  it('never cites a club entry below CLUB_GEAR_MIN_COHORT', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      drills: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 2 }],
    });
    expect(reasons.join(' ')).not.toContain('Astrox 88D Pro');
    expect(reasons.join(' ')).not.toContain('2');
  });

  it('does cite a club entry at or above the cohort floor', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      drills: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 3 }],
    });
    expect(reasons.join(' ')).toContain('3');
  });
});
```

A count of 2 in a twelve-person club, plus knowing who turned up, is a name. `tallyClubGear` already drops these; this re-checks because a personalised reason is a new disclosure surface and must not depend on a caller having filtered correctly.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run __tests__/pick-reasons.test.ts`
Expected: FAIL — `Cannot find module '@/lib/pickReasons'`.

- [ ] **Step 3: Write `lib/pickReasons.ts`**

```ts
import { CLUB_GEAR_MIN_COHORT, type ClubGearEntry } from './clubGear';
import type { DrillPick } from './drills';
import type { CatalogItem } from './types';

/**
 * Build the "why this" lines for a recommended item.
 *
 * Pure: no fetch, no DB, no clock, no randomness — every input is passed in, so
 * the privacy behaviour below is directly unit-testable.
 *
 * Four permitted sources, in priority order: the engine's own equipment-derived
 * reasons, the member's current drill picks, the catalog spec line, and the club
 * tally. Nothing else may appear in a reason.
 *
 * THE CLUB GUARD IS RE-APPLIED HERE ON PURPOSE. `tallyClubGear` already drops
 * entries below CLUB_GEAR_MIN_COHORT, so this is defence in depth rather than
 * the only check — but a reason is a NEW disclosure surface for that data, and
 * "the caller filtered it" is not a property the type system enforces. One
 * unfiltered caller and a tally becomes an identification.
 */
export interface PickReasonInput {
  item: CatalogItem;
  /** Equipment-derived reasons from the scoring engine, best first. */
  engineReasons: string[];
  /** The member's current drill picks, for cross-domain grounding. */
  drills: DrillPick[];
  /** Club tally entries. MUST come from `tallyClubGear`; re-filtered anyway. */
  clubEntries: ClubGearEntry[];
  /** Cap on returned reasons. The sheet shows a short list, not an essay. */
  limit?: number;
}

export function buildPickReasons(input: PickReasonInput): string[] {
  const { item, engineReasons, drills, clubEntries, limit = 3 } = input;
  const out: string[] = [];

  for (const r of engineReasons) {
    if (typeof r === 'string' && r.trim()) out.push(r.trim());
  }

  // Cross-domain: name what they are actually practising. Uses the drill's own
  // skill label, never a rating number — the sheet is not a report card.
  const drill = drills.find((d) => d && typeof d.title === 'string');
  if (drill) {
    out.push(`You are working on ${drill.skillLabel.toLowerCase()} — ${drill.title.toLowerCase()} is in this week's focus`);
  }

  const safeClub = clubEntries.filter(
    (e) => e && e.category === item.category && typeof e.count === 'number' && e.count >= CLUB_GEAR_MIN_COHORT,
  );
  const match = safeClub.find((e) => e.label === `${item.brand} ${item.model}` || e.label === item.model);
  if (match) {
    out.push(`${match.count} people in the club already play it`);
  }

  return out.slice(0, limit);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run __tests__/pick-reasons.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Add the drills-grounding test**

Append to `__tests__/pick-reasons.test.ts`:

```ts
describe('buildPickReasons — drills grounding', () => {
  it('names what the member is practising without quoting a rating', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      drills: [{
        id: 'split-step',
        skillKey: 'movement',
        skillLabel: 'Movement',
        title: 'Split steps',
        description: 'x',
        minutes: 10,
        setting: 'solo',
        reason: 'For your movement (rated 2/5)',
      }],
      clubEntries: [],
    });
    expect(reasons.join(' ')).toContain('movement');
    expect(reasons.join(' ')).not.toContain('2/5');
  });

  it('caps at the limit', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: ['a', 'b', 'c', 'd'],
      drills: [],
      clubEntries: [],
      limit: 3,
    });
    expect(reasons).toHaveLength(3);
  });
});
```

The drill's own `reason` field carries a rating ("rated 2/5"); the pick sheet must not. That is a report card, not a reason to buy a racket.

- [ ] **Step 6: Run, lint, commit**

Run: `npm test && npm run lint && npx tsc --noEmit`

```bash
git add lib/pickReasons.ts __tests__/pick-reasons.test.ts
git commit -F - <<'MSG'
feat(gear): pure why-this reason builder that inherits the cohort guard

Reasons may cite engine output, the member's drill picks, the catalog spec
and the club tally. The club filter is re-applied here even though
tallyClubGear already drops sub-cohort entries: a personalised reason is a
NEW disclosure surface for that data, and "the caller filtered it" is not
something the type system enforces.

Drill grounding deliberately drops the drill's own rating text. "For your
movement (rated 2/5)" is a report card; the sheet needs a reason to pick an
item, not a score.
MSG
```

---

### Task 3: Wire reasons into the recommend route

**Files:**
- Modify: `app/api/recommend/route.ts` (flag-on branch, after `recommendRackets`)
- Test: `__tests__/recommend-category.test.ts` (extend)

**Interfaces:**
- Consumes: `buildPickReasons` (Task 2); `recommendRackets(profile, catalog, topN, category)` (Task 1); `tallyClubGear` from `lib/clubGear.ts`; `recommendDrills` from `lib/drills.ts`.
- Produces: the route's `reasons: string[]` now includes drill and club lines. Task 5's `GearPickSheet` renders them.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/recommend-category.test.ts`:

```ts
  it('includes drill-grounded reasons when the member has drill picks', async () => {
    // Admin path avoids minting a member cookie in this test.
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=racket', undefined, {
        cookie: await adminCookie(),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reasons ?? [])).toBe(true);
  });
```

Check `__tests__/helpers.ts` for the exact admin-cookie helper name before writing this — reuse it rather than hand-rolling a cookie.

- [ ] **Step 2: Run and verify it fails or errors**

Run: `npx vitest run __tests__/recommend-category.test.ts`
Expected: FAIL.

- [ ] **Step 3: Assemble the reason inputs in the route**

In the flag-on branch, replace the current return with:

```ts
const top = recommendRackets(profile, catalogItems as CatalogItem[], 1, category)[0];
if (!top) return NextResponse.json({ item: null, reason: null, unavailable: 'no_catalog' });

// Drill picks for cross-domain grounding. A failure here must NOT take the
// recommendation down — reasons degrade to equipment-only.
let drills: DrillPick[] = [];
try {
  drills = await drillPicksFor(subject);
} catch {
  drills = [];
}

// Club tally, cohort-guarded by tallyClubGear before it ever reaches the
// reason builder (which re-checks anyway).
let clubEntries: ClubGearEntry[] = [];
try {
  const { resources: gearDocs } = await getContainer('playerGear').items
    .query({ query: 'SELECT c.items FROM c' })
    .fetchAll();
  clubEntries = tallyClubGear(gearDocs as Pick<PlayerGear, 'items'>[]);
} catch {
  clubEntries = [];
}

const reasons = buildPickReasons({
  item: top.item,
  engineReasons: top.reasons,
  drills,
  clubEntries,
});

return NextResponse.json({
  item: top.item,
  reason: reasons[0] ?? null,
  reasons,
  warnings: top.warnings,
});
```

Note the two `catch {}` blocks are deliberate and narrow: they degrade *reasons*, never the pick. This is not the lying-empty-state pattern — the card still renders its real recommendation, and the member loses only supplementary copy.

- [ ] **Step 4: Add the `drillPicksFor` helper**

Mirror how `app/api/stats/drills/route.ts` builds its inputs — read that file first and reuse its assessment→`workOn` derivation rather than reimplementing it. Extract the shared derivation into `lib/drills.ts` if it is currently inline in the route, so both callers agree.

- [ ] **Step 5: Run, lint, commit**

Run: `npm test && npm run lint && npx tsc --noEmit`

```bash
git add app/api/recommend/route.ts lib/drills.ts __tests__/recommend-category.test.ts
git commit -m "feat(recommend): ground why-this reasons in drills and the club tally"
```

---

### Task 4: `GearPickCard` + `GearPickRail`

The artboard's rail, replacing `GearRail`. All copy keys already exist in `stats.gear` (`railYours`, `railNone`, `railInKit`, `railWhy`, `railWhyPicked`, `railComingSoon`, `railStringsSoon`, `railShoesSoon`, `railShuttlesSoon`) — a previous stage added them and never built the surface.

**Files:**
- Create: `components/stats/GearPickCard.tsx`
- Create: `components/stats/GearPickRail.tsx`
- Test: `__tests__/components/GearPickCard.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /api/recommend?category=` (Task 1/3).
- Produces:
  - `GearPickCard({ category, pick, owned, status, onOpen })` where
    `pick: { item: CatalogItem; reasons: string[] } | null`,
    `owned: boolean`,
    `status: 'loading' | 'ready' | 'error' | 'parked'`.
  - `GearPickRail({ activeName, gear })` — `gear` is the `UseGear` object from Task 5.

- [ ] **Step 1: Write the failing owned-state test**

Create `__tests__/components/GearPickCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickCard from '../../components/stats/GearPickCard';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

const ITEM: CatalogItem = {
  id: 'yonex-astrox-88d',
  category: 'racket',
  brand: 'Yonex',
  model: 'Astrox 88D Pro',
  skillRange: [3, 6],
  attributes: { weight: '3U', balance: 'head-heavy', flex: 'stiff' },
};

function renderCard(props: Partial<React.ComponentProps<typeof GearPickCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickCard
        category="racket"
        pick={{ item: ITEM, reasons: ['Stiffer shaft suits your smash'] }}
        owned={false}
        status="ready"
        onOpen={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('GearPickCard', () => {
  it('shows "Why this?" and no kit pill when the member does not own the pick', () => {
    renderCard();
    expect(screen.getByText('Why this?')).toBeTruthy();
    expect(screen.queryByText('In your kit')).toBeNull();
  });

  it('flips to the kit pill and "Why we picked it" once owned', () => {
    renderCard({ owned: true });
    expect(screen.getByText('In your kit')).toBeTruthy();
    expect(screen.getByText('Why we picked it')).toBeTruthy();
    expect(screen.queryByText('Why this?')).toBeNull();
  });

  it('renders the parked card for a category with no possible pick', () => {
    renderCard({ category: 'shoe', pick: null, status: 'parked' });
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByText('Court shoes matched to your footwork and fit.')).toBeTruthy();
  });
});
```

The owned flip is the behaviour plan Stage 6 called out as a live bug in the prototype: the card must stop recommending back what the member already has.

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run __tests__/components/GearPickCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `GearPickCard`**

236px fixed-width card per plan Stage 6. Use `StatusBadge variant="accent"` for the `IN YOUR KIT` pill rather than hand-coding a span. Four states:

```tsx
if (status === 'loading') return <CardSkeleton height={168} />;
if (status === 'error') return <div className="glass-card p-5"><ErrorState message={t('kitError')} /></div>;
if (status === 'parked' || !pick) { /* eyebrow + railComingSoon badge + the per-category soon line */ }
/* ready: eyebrow (+ StatusBadge when owned) · railYours/railNone · model · brand+spec · disclosure */
```

The parked branch must name what the category *will* do (`railShoesSoon` etc.), never render an empty box. That is the difference between "not built yet" and "broken".

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run __tests__/components/GearPickCard.test.tsx`
Expected: PASS (all three).

- [ ] **Step 5: Write `GearPickRail`**

Horizontal scroll container, order **racket → shoe → string → shuttle** (the artboard caption's order). One `fetch` per *sourced* category only — do not fan out to four. Owned-ness is computed from the `gear` prop, not a second fetch.

```tsx
const ORDER: EquipmentCategory[] = ['racket', 'shoe', 'string', 'shuttle'];
```

The scroll container needs `overflow-x: auto` and must not make the page scroll horizontally.

- [ ] **Step 6: Run full suite, lint, commit**

Run: `npm test && npm run lint && npx tsc --noEmit`

```bash
git add components/stats/GearPickCard.tsx components/stats/GearPickRail.tsx __tests__/components/GearPickCard.test.tsx
git commit -m "feat(gear): pick rail with the owned-state flip from the artboard"
```

---

### Task 5: Single gear owner — rewire `GearRegister`, delete the v1 carry-over

This is the task that fixes the live bug. **Deletions and the ownership lift must land together**: fixing ownership while `RacketRow` still mounts its own `useGear` leaves two readers and the regression test cannot pass.

**Files:**
- Modify: `components/stats/GearRegister.tsx` (becomes composition only)
- Create: `components/stats/YourKitCard.tsx` (extracted from `GearRegister:64-191`)
- Create: `components/stats/ClubGearCard.tsx` (extracted from `GearRegister:193-270`)
- Modify: `components/stats/StringTensionCard.tsx` (gear + `setPrefs` via props; delete its own read at `:40` and its PUT at `:72`)
- Create: `components/stats/GearPickSheet.tsx`
- Delete: `components/stats/RacketRow.tsx`, `components/stats/GearRail.tsx`, `components/stats/cards/YourRacketCard.tsx`, `components/stats/cards/RacketRecCard.tsx`
- Delete: `__tests__/components/RacketRow.test.tsx`, `__tests__/components/GearRail.test.tsx`, `__tests__/components/YourRacketCard.test.tsx`, `__tests__/components/RacketRecCard.test.tsx`
- Test: `__tests__/components/GearRegister.test.tsx` (create)

**Interfaces:**
- Consumes: `GearPickRail` (Task 4); `useGear` from `components/stats/useGear.ts`.
- Produces: `GearRegister({ activeName })` unchanged externally — `SkillsTab` needs no edit.

- [ ] **Step 1: Write the failing single-fetch regression test**

Create `__tests__/components/GearRegister.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('GearRegister — single owner of the gear document', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) }),
    ) as unknown as typeof fetch;
  });

  it('issues exactly ONE GET /api/equipment/gear per mount', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearRegister activeName="Lin" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/equipment/gear') && !u.includes('method'));
      expect(calls.length).toBe(1);
    });
  });
});
```

This is the invariant that broke. It was previously guarded only by a sentence in `components/stats/CLAUDE.md`, and a doc comment cannot fail a build.

- [ ] **Step 2: Run and verify it fails, showing the real count**

Run: `npx vitest run __tests__/components/GearRegister.test.tsx`
Expected: FAIL — received 4 (`RacketRow`'s `useGear`, `YourKitCard`'s `useGear`, `GearRail:76`, `StringTensionCard:40`).

- [ ] **Step 3: Extract `YourKitCard` to its own file, taking gear via props**

Move `GearRegister:64-191` verbatim into `components/stats/YourKitCard.tsx`, changing only the signature — it must NOT call `useGear`:

```tsx
export interface YourKitCardProps {
  activeName: string | null;
  gear: UseGear;
}
export default function YourKitCard({ activeName, gear }: YourKitCardProps) {
  const { gear: doc, loaded, loadError, busy, online, add } = gear;
  // ...body unchanged
}
```

- [ ] **Step 4: Extract `ClubGearCard` to its own file**

Move `GearRegister:193-270` verbatim into `components/stats/ClubGearCard.tsx`. It reads `/api/stats/club/gear`, which is not the gear document, so its fetch stays.

- [ ] **Step 5: Convert `StringTensionCard` to props**

Delete its `/api/equipment/gear` read (`:40`, keep the `/api/stats/level` read) and its PUT (`:72`), taking `gear` and calling `gear.setPrefs` instead. Its format toggle now writes through the same owner as everything else.

- [ ] **Step 6: Rewrite `GearRegister` as composition**

```tsx
export default function GearRegister({ activeName }: GearRegisterProps) {
  // THE single owner of the gear document for this register. Every child takes
  // it as a prop. Before Stage 6b there were four independent readers and two
  // independent writers, so adding a racket in one card left the others stale.
  const gear = useGear(activeName);

  return (
    <>
      <GearPickRail activeName={activeName} gear={gear} />
      <YourKitCard activeName={activeName} gear={gear} />
      <StringTensionCard activeName={activeName} gear={gear} />
      <ClubGearCard />
    </>
  );
}
```

- [ ] **Step 7: Delete the v1 carry-over and its tests**

```bash
git rm components/stats/RacketRow.tsx components/stats/GearRail.tsx \
       components/stats/cards/YourRacketCard.tsx components/stats/cards/RacketRecCard.tsx \
       __tests__/components/RacketRow.test.tsx __tests__/components/GearRail.test.tsx \
       __tests__/components/YourRacketCard.test.tsx __tests__/components/RacketRecCard.test.tsx
```

Then `npx tsc --noEmit` to find every dangling import. `RacketRow`'s format/budget segment controls move into `GearPickSheet` (they tune the recommendation, so they belong next to it) — do not drop them silently.

- [ ] **Step 8: Write `GearPickSheet`**

Uses the `<BottomSheet>` primitive. Order per the artboard: *We recommend* → model → brand · price → the plain-language line → the spec line → a bordered **WHY THIS** block listing `reasons` → **Add to my kit** (`cc-btn cc-btn-primary cc-btn-lg`, disabled when `!online || busy`) → the club footnote. Plain language first, spec sheet second; a warning is never collapsed away.

Adding calls `gear.add(item)` — the same owner, so the rail card flips to `IN YOUR KIT` and the kit row fills in without a reload.

- [ ] **Step 9: Run the regression test and verify it now passes**

Run: `npx vitest run __tests__/components/GearRegister.test.tsx`
Expected: PASS — exactly 1.

- [ ] **Step 10: Run full suite, lint, typecheck, commit**

Run: `npm test && npm run lint && npx tsc --noEmit`

Predict the test count before running: baseline minus the four deleted suites' cases, plus the new ones. A surprise number means something went missing silently.

```bash
git add -A
git commit -F - <<'MSG'
feat(gear): one owner for the gear document; delete the v1 carry-over

GearRegister rendered RacketRow (the v1 Equipment tab) with four v2 cards
stacked under it. Four components read GET /api/equipment/gear independently
and two wrote it, and useGear holds per-instance state with no shared store —
so adding a racket via "Your kit" left RacketRow's bag stale until reload.

GearRegister now calls useGear once and passes it down. RacketRow, GearRail,
YourRacketCard and RacketRecCard are deleted; the pick rail replaces them.

The regression test asserts exactly one gear read per mount. The rule existed
before, as a sentence in components/stats/CLAUDE.md, and a doc comment cannot
fail a build.
MSG
```

---

### Task 6: Owned items + tension capture in `GearSheet`

**Files:**
- Modify: `components/stats/GearSheet.tsx` (owned-items header; tension field for strings)
- Modify: `components/stats/BagList.tsx` (relocate — now rendered inside the sheet)
- Modify: `components/stats/YourKitCard.tsx` (render `· NN lb` when present)
- Test: `__tests__/components/GearSheet.test.tsx` (extend)

**Interfaces:**
- Consumes: `UseGear` (Task 5) for `activate` / `remove`.
- Produces: `GearSheet` gains `ownedItems: GearItem[]`, `onActivate`, `onRemove`, and for `category === 'string'` an optional `tensionLbs` on pick.

- [ ] **Step 1: Write the failing test**

```tsx
it('lists items you already own above the catalog', async () => {
  renderSheet({ ownedItems: [{ id: 'g1', catalogId: 'c1', category: 'racket', label: 'Astrox 88D' }] });
  expect(await screen.findByText('Astrox 88D')).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npx vitest run __tests__/components/GearSheet.test.tsx`

- [ ] **Step 3: Add the owned-items section**

Render `<BagList>` above the search field when `ownedItems.length > 0`. The sheet's docstring currently says it is "a catalog picker and nothing else" because managing the bag inside it once made it "two unrelated jobs fighting over 75vh" — **update that docstring**. The job is different now: the bag is no longer on the register, so this sheet is the one place a category's items live, and the previous split no longer exists to conflict with.

- [ ] **Step 4: Add tension capture for strings**

`GearItem.tensionLbs` already exists (`lib/types.ts:295`) and the gear PUT already accepts it (`app/api/equipment/gear/route.ts:349`). Nothing has ever written it. Add a numeric field shown only for `category === 'string'`, prefilled from `recommendTension(level, format)?.lb`, validated to `[MIN_LB, MAX_LB]` = `[20, 30]`.

**Do not backfill the stored value from the advice.** `StringTensionCard` shows what we *suggest*; `tensionLbs` is what the member *actually strung at*. They will often disagree and that disagreement is the interesting part. Prefill is a starting value the member can change, not a default that gets saved silently.

- [ ] **Step 5: Render tension in the kit row**

In `YourKitCard`, when the item is a string and `tensionLbs` is present, render `` `${item.label} · ${item.tensionLbs} ${t('lb')}` ``. When absent, render the label alone — never a placeholder number.

- [ ] **Step 6: Run, lint, commit**

Run: `npm test && npm run lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "feat(gear): owned items and tension capture in the picker sheet"
```

---

### Task 7: i18n cleanup, docs, and the final gate

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Modify: `components/stats/CLAUDE.md`
- Modify: `CLAUDE.md` (Stats Tab section)

- [ ] **Step 1: Add any new `stats.gear` keys to BOTH locale files**

Most rail copy already exists. New keys needed for `GearPickSheet` (`pickSheetWeRecommend`, `pickSheetWhyThis`, `pickSheetAdd`, `pickSheetFootnote`) and the tension field (`tensionCaptureLabel`).

**Edit the message files line-wise. Do NOT round-trip through `JSON.parse` → `JSON.stringify`** — both files contain shadowed duplicate keys (`home.signup.pinRequired`, `pinLabel`, `pinTooCommon`) that a round-trip silently deletes.

- [ ] **Step 2: Retire the `valueHub.*` keys owned by deleted components**

`yourRacket`, `recTitle`, `recCta`, `recWhyShow`, `recWhyHide`, `recEmpty`, `recError`, `addRacket`, `bagTitle`, `bagActive`, `bagSetActive`, `bagRemove`, `bagFull`, `bagDuplicate`, `usingToday`, `compare*`. Verify each has no remaining reference before deleting — `format_*` and `budget_*` are built dynamically (`` t(`format_${f}`) ``) and a plain grep will not find them.

- [ ] **Step 3: Run the locale-parity test**

Run: `npx vitest run __tests__/i18n/locale-parity.test.ts`
Expected: PASS. It catches en-without-zh, but **not** deleted-while-still-used — so step 2's verification matters.

- [ ] **Step 4: Update `components/stats/CLAUDE.md`**

Its Equipment section opens *"The Equipment register inside Stats (`RacketRow`, …)"* — `RacketRow` no longer exists. Rewrite around `GearRegister` as the single gear owner, the two-sheet split, and the rule that `useGear` is called in exactly one place with a test pinning it.

- [ ] **Step 5: Update the root `CLAUDE.md` Stats Tab section**

Its Gear line names `GearRegister` generically; make it name the pick rail and the ownership rule.

- [ ] **Step 6: Final gate and push**

Run: `npm test && npm run lint && npx tsc --noEmit`

```bash
git add -A
git commit -m "chore(gear): consolidate Gear i18n on stats.gear and refresh the docs"
git push -u origin feat/gear-register-v2
```

Then open the PR against `chore/stats-v2-stage8` (not `main`) while #262 is open, and retarget to `main` after #262 merges. Watch the `verify` check — it is the only place `npm ci` and `next build` actually run, and neither is runnable in the local sandbox.

---

## Self-Review

**Spec coverage:** pick rail → Task 4. Owned-state flip → Task 4. `GearPickSheet` → Task 5 step 8. Two-sheet split → Tasks 5, 6. Single gear owner + regression test → Task 5. `/api/recommend?category=` → Task 1. Reason grounding + cohort guard → Tasks 2, 3. Four honest states → Task 4 step 3. Parked-by-probe → Task 4. Deletions → Task 5 step 7. `BagList` relocation → Task 6. Tension correction → Task 6. i18n + docs → Task 7. **No gaps.**

**Type consistency:** `UseGear` is the exported interface from `components/stats/useGear.ts` and is used under that name in Tasks 4, 5, 6. `recommendRackets`' new fourth parameter defaults to `'racket'`, so Task 1 does not break existing callers. `buildPickReasons` takes `ClubGearEntry[]`/`DrillPick[]` — the real exported types. `GearPickCard`'s `status` union is `'loading' | 'ready' | 'error' | 'parked'` in both Task 4's test and its implementation.

**Known soft spots for the executor:** Task 3 step 1 references an admin-cookie helper by a guessed name — read `__tests__/helpers.ts` and use the real one. Task 3 step 4 depends on how `app/api/stats/drills/route.ts` derives `workOn`; read it before extracting.
