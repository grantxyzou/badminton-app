# Equipment Bag View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Equipment tab lead with the player's own racket at hero weight, expand the catalog from 15 to 50 rackets, add search, and let a player hold multiple rackets with one marked active.

**Architecture:** Four sequenced pieces. The catalog import is an author-time script whose output is committed — no runtime change. The hierarchy and card-content work is pure client rendering driven by a new pure-function module (`lib/racketSpecs.ts`) so every spec string is unit-testable without a DOM. The bag adds one optional field to `PlayerGear` plus three server-merged verbs; the client never writes the whole array.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Cosmos DB (mock store in tests), Vitest + @testing-library/react, next-intl.

**Spec:** `docs/superpowers/specs/2026-08-17-equipment-bag-view-design.md`

## Global Constraints

- Flag: everything ships under the existing `NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE`. No new flag.
- `CatalogItem.category` is the Cosmos **partition key** and must always be the literal `'racket'`. The source file's `category` field means play-style and must never be written there.
- Schema changes are additive and optional only — stable and next share one Cosmos DB.
- Gear writes are member-scoped (Security Rule 12): `verifyMemberAuth` owner match OR `isAdminAuthedWithMember`. Rate limit before auth (Rule 4); `getClientIp(req)` for IP (Rule 6), never `req.ip`.
- **Ordering caveat, deliberate:** Rule 3 says "auth before body parsing", but these handlers take the target `name` from the request body, so the body must be parsed before the member can be resolved and the caller authorized. The existing `PUT` already works this way. The rule's intent — no DB work or side effects before the auth gate — is preserved: parsing is followed immediately by the rate-limit check, then member resolution, then auth, and nothing mutates before that gate passes.
- No raw inline `fontSize` numbers, hex literals, or bare `text-xs/sm/base` classes — use `--fs-*` tokens / `.fs-*` classes. `components/stats` errors on `DESIGN_TOKEN_SELECTORS`.
- Component tests need `// @vitest-environment jsdom`, manual `afterEach(cleanup)`, and a `<NextIntlClientProvider locale="en" messages={enMessages}>` wrapper.
- New `messages/*.json` keys go under the existing `valueHub` namespace — no new top-level branch (avoids the next-intl HMR restart trap).
- Run tests with `npx vitest run <path>`; full suite `npm test`; types `npm run typecheck`.

## File Structure

**Create:**
- `scripts/data/racket_database.source.json` — the 39-record source, committed for reproducibility
- `scripts/import-racket-database.mjs` — author-time mapper, run once, output committed
- `lib/racketSpecs.ts` — pure display helpers: `playStyleLabel`, `weightLabel`, `specTiers`, `compareRackets`
- `lib/activeRacket.ts` — pure resolver: active racket out of a `PlayerGear`
- `__tests__/racket-specs.test.ts`, `__tests__/active-racket.test.ts`, `__tests__/equipment-catalog-data.test.ts`, `__tests__/equipment-gear-bag.test.ts`
- `components/stats/cards/YourRacketCard.tsx` — the hero card, extracted from `RacketRow`
- `components/stats/BagList.tsx` — bag rows inside `GearSheet`

**Modify:**
- `scripts/data/equipment-catalog.json` — 15 → 50 items (script output)
- `components/stats/RacketRow.tsx` — grid → stack; fetches catalog to resolve the current item
- `components/stats/cards/RacketRecCard.tsx` — accepts `mine`, renders the comparison line
- `components/stats/GearSheet.tsx` — search field; `POST` instead of `PUT`; renders `BagList`
- `app/api/equipment/gear/route.ts` — add `POST` / `PATCH` / `DELETE`
- `lib/types.ts` — `PlayerGear.activeRacketId?: string`
- `messages/en.json`, `messages/zh-CN.json` — new `valueHub` keys

`lib/racketSpecs.ts` exists so display logic is testable as pure functions rather than through the DOM, and so `YourRacketCard`, `RacketRecCard`, and `GearSheet` rows cannot drift in how they render the same specs.

---

# Phase 1 — Catalog, hierarchy, card content, search

Tasks 1–5. Ships as one PR. No schema change, no new API verbs.

---

### Task 1: Import the racket database (15 → 50)

**Files:**
- Create: `scripts/data/racket_database.source.json` (copy of the supplied file)
- Create: `scripts/import-racket-database.mjs`
- Modify: `scripts/data/equipment-catalog.json`
- Test: `__tests__/equipment-catalog-data.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `scripts/data/equipment-catalog.json` with 50 `CatalogItem` rows. Ids are `racket-<source-id>`. Every row has `category: 'racket'`, a 2-element `skillRange`, and an `attributes` map that may contain `series`, `playStyle`, `balance`, `flex`, `weight`, `weightGrams`, `frameMaterial`, `stringTensionLbs`, `gripSize`, `notes`.

- [ ] **Step 1: Copy the source file into the repo**

```bash
cp "/Users/gz-mac/Downloads/files/racket_database.json" \
   "scripts/data/racket_database.source.json"
```

- [ ] **Step 2: Write the failing data test**

Create `__tests__/equipment-catalog-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import type { CatalogItem } from '../lib/types';

const items = catalog.items as unknown as CatalogItem[];

describe('equipment catalog data', () => {
  it('holds the merged 50-racket catalog', () => {
    expect(items).toHaveLength(50);
  });

  // category IS the Cosmos partition key. The source file's `category` means
  // play-style ("Power"); writing it here scatters rows across bogus
  // partitions and GET ?category=racket returns nothing — the empty-catalog
  // outage fixed in de2505e.
  it('uses racket as the partition key on every row, never a play-style', () => {
    for (const item of items) {
      expect(item.category).toBe('racket');
    }
  });

  it('never carries the source partitionKey field', () => {
    for (const item of items) {
      expect(item).not.toHaveProperty('partitionKey');
    }
  });

  it('gives every row a two-element skillRange the recommender can read', () => {
    for (const item of items) {
      expect(item.skillRange).toHaveLength(2);
      expect(item.skillRange[0]).toBeLessThanOrEqual(item.skillRange[1]);
    }
  });

  it('keeps ids unique and racket-prefixed', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('racket-')).toBe(true);
  });

  // The 4 overlaps keep their curated CAD msrp + retailer links rather than
  // being overwritten by the import.
  it('preserves the curated data on rackets that existed before the import', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-88d-pro');
    expect(astrox?.msrp).toBe(309);
    expect(astrox?.sources?.[0]?.retailer).toBe('Yumo');
  });

  it('imports new rackets with converted pricing and derived skillRange', () => {
    const zz = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(zz?.brand).toBe('Yonex');
    expect(zz?.attributes?.weightGrams).toBe('83-88');
    expect(zz?.attributes?.playStyle).toBe('Power');
    expect(zz?.skillRange).toEqual([4, 6]); // tier: Premium
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run __tests__/equipment-catalog-data.test.ts`
Expected: FAIL — `expected 15 to be 50`

- [ ] **Step 4: Write the import script**

Create `scripts/import-racket-database.mjs`:

```js
#!/usr/bin/env node
/**
 * Author-time import: merges scripts/data/racket_database.source.json into
 * scripts/data/equipment-catalog.json. Run once; the OUTPUT is committed.
 * Not part of the runtime path.
 *
 * Union, never replace. Only 4 of the 15 existing rackets appear in the
 * source file — replacing would orphan the other 11, and every player's
 * gear.catalogId pointing at them would dangle. Prefixing source ids with
 * `racket-` makes those 4 collide EXACTLY with their existing ids, so
 * "existing wins" falls out of a Map insert.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'data', 'racket_database.source.json');
const TARGET = join(here, 'data', 'equipment-catalog.json');

// `tier` is the only clean three-way split in the source. Its `category`
// field has 20 free-text values ("Power (beginner step-up)", "Speed/Control")
// and cannot drive logic.
const TIER_RANGE = {
  'Entry-level': [1, 3],
  'Mid-range': [2, 5],
  Premium: [4, 6],
};

const USD_TO_CAD = 1.38;

/** "$220-250" -> 304 (CAD, low end). "$75" -> 103. Unparseable -> undefined. */
function msrpCad(priceUSD) {
  const match = String(priceUSD ?? '').match(/(\d+)/);
  if (!match) return undefined;
  return Math.round(Number(match[1]) * USD_TO_CAD);
}

function mapRecord(raw) {
  const attributes = {};
  const put = (key, value) => {
    if (value !== undefined && value !== null && value !== '') attributes[key] = value;
  };
  put('series', raw.series);
  put('playStyle', raw.category); // play-style, NOT the partition key
  put('balance', raw.balance);
  put('flex', raw.flex);
  put('weight', raw.weightClass);
  put('weightGrams', raw.weightGrams);
  put('frameMaterial', raw.frameMaterial);
  put('stringTensionLbs', raw.stringTensionLbs);
  put('gripSize', raw.gripSize);
  put('notes', raw.notes);

  const item = {
    id: `racket-${raw.id}`,
    category: 'racket', // partition key — always this literal
    brand: raw.brand,
    model: raw.model,
    skillRange: TIER_RANGE[raw.tier] ?? [1, 6],
    attributes,
    seeded: true,
  };
  const msrp = msrpCad(raw.priceUSD);
  if (msrp !== undefined) item.msrp = msrp;
  return item;
}

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const target = JSON.parse(readFileSync(TARGET, 'utf8'));

const byId = new Map(target.items.map((i) => [i.id, i]));
let added = 0;
for (const raw of source) {
  const mapped = mapRecord(raw);
  if (byId.has(mapped.id)) continue; // existing curation wins
  byId.set(mapped.id, mapped);
  added += 1;
}

target.items = [...byId.values()];
writeFileSync(TARGET, `${JSON.stringify(target, null, 2)}\n`);
console.log(`added ${added}, catalog now ${target.items.length}`);
```

- [ ] **Step 5: Run the import**

Run: `node scripts/import-racket-database.mjs`
Expected: `added 35, catalog now 50`

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run __tests__/equipment-catalog-data.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 7: Verify the recommender still works against the bigger catalog**

Run: `npx vitest run __tests__/equipment-catalog-seed.test.ts __tests__/recommend.test.ts __tests__/recommend-route.test.ts`
Expected: PASS. If a recommend test pins an exact model, the wider catalog may have changed the pick — update the expectation only if the new pick is defensible for that stage.

- [ ] **Step 8: Commit**

```bash
git add scripts/data/racket_database.source.json scripts/import-racket-database.mjs \
        scripts/data/equipment-catalog.json __tests__/equipment-catalog-data.test.ts
git commit -m "feat(equipment): expand racket catalog 15 -> 50 via union import"
```

---

### Task 2: Racket spec display helpers

**Files:**
- Create: `lib/racketSpecs.ts`
- Test: `__tests__/racket-specs.test.ts`

**Interfaces:**
- Consumes: `CatalogItem` from `lib/types`
- Produces:
  - `playStyleLabel(item: CatalogItem): string | null` — `"Power (beginner step-up)"` → `"Power"`
  - `weightLabel(item: CatalogItem): string | null` — `"4U"` + `"83-88"` → `"4U (83–88g)"`
  - `specTiers(item: CatalogItem): { plain: string | null; specs: string | null }`
  - `compareRackets(mine: CatalogItem | null, theirs: CatalogItem): string | null` — returns one of `'lighter' | 'heavier' | 'moreHeadLight' | 'moreHeadHeavy' | 'moreFlexible' | 'stiffer'` as an i18n **key suffix**, or `null`

- [ ] **Step 1: Write the failing test**

Create `__tests__/racket-specs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { playStyleLabel, weightLabel, specTiers, compareRackets } from '../lib/racketSpecs';
import type { CatalogItem } from '../lib/types';

function racket(attributes: Record<string, string>): CatalogItem {
  return { id: 'x', category: 'racket', brand: 'Yonex', model: 'M', skillRange: [1, 6], attributes };
}

describe('playStyleLabel', () => {
  it('keeps a plain value', () => {
    expect(playStyleLabel(racket({ playStyle: 'Power' }))).toBe('Power');
  });
  it('drops a parenthetical qualifier', () => {
    expect(playStyleLabel(racket({ playStyle: 'Power (beginner step-up)' }))).toBe('Power');
  });
  it('takes the first term of a slashed value', () => {
    expect(playStyleLabel(racket({ playStyle: 'All-round / Speed' }))).toBe('All-round');
    expect(playStyleLabel(racket({ playStyle: 'Speed/Control' }))).toBe('Speed');
  });
  it('returns null when absent', () => {
    expect(playStyleLabel(racket({}))).toBeNull();
  });
});

describe('weightLabel', () => {
  it('folds the gram range into the weight class', () => {
    expect(weightLabel(racket({ weight: '4U', weightGrams: '83-88' }))).toBe('4U (83–88g)');
  });
  // The 15 legacy rows have no weightGrams — degrade, never render "4U ()".
  it('renders the class alone when grams are missing', () => {
    expect(weightLabel(racket({ weight: '4U' }))).toBe('4U');
  });
  it('returns null when there is no weight at all', () => {
    expect(weightLabel(racket({}))).toBeNull();
  });
});

describe('specTiers', () => {
  it('splits plain language from specs', () => {
    const r = racket({ playStyle: 'Power', balance: 'Head-heavy', weight: '4U', weightGrams: '83-88', flex: 'Extra Stiff' });
    expect(specTiers(r)).toEqual({ plain: 'Power · Head-heavy', specs: '4U (83–88g) · Extra Stiff' });
  });
  it('omits the plain tier entirely when there is no play style', () => {
    const r = racket({ balance: 'Head-heavy', weight: '4U' });
    expect(specTiers(r)).toEqual({ plain: 'Head-heavy', specs: '4U' });
  });
  it('returns nulls for a bare item rather than empty strings', () => {
    expect(specTiers(racket({}))).toEqual({ plain: null, specs: null });
  });
});

describe('compareRackets', () => {
  const mine = racket({ weight: '3U', balance: 'Head-heavy', flex: 'Stiff' });

  it('reports weight first — the most felt difference', () => {
    const theirs = racket({ weight: '4U', balance: 'Head-light', flex: 'Flexible' });
    expect(compareRackets(mine, theirs)).toBe('lighter');
  });
  it('falls through to balance when weight ties', () => {
    const theirs = racket({ weight: '3U', balance: 'Head-light', flex: 'Flexible' });
    expect(compareRackets(mine, theirs)).toBe('moreHeadLight');
  });
  it('falls through to flex when weight and balance tie', () => {
    const theirs = racket({ weight: '3U', balance: 'Head-heavy', flex: 'Extra Stiff' });
    expect(compareRackets(mine, theirs)).toBe('stiffer');
  });
  it('returns null when nothing differs', () => {
    expect(compareRackets(mine, racket({ weight: '3U', balance: 'Head-heavy', flex: 'Stiff' }))).toBeNull();
  });
  it('returns null when the player has no racket to compare against', () => {
    expect(compareRackets(null, racket({ weight: '5U' }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/racket-specs.test.ts`
Expected: FAIL — cannot resolve `../lib/racketSpecs`

- [ ] **Step 3: Write the implementation**

Create `lib/racketSpecs.ts`:

```ts
import type { CatalogItem } from './types';

/**
 * Pure display helpers for racket specs. Lives outside the components so the
 * hero card, the recommendation card and the picker rows cannot drift in how
 * they render the same item, and so every string is testable without a DOM.
 *
 * Everything degrades by omission. The 15 pre-import rows have no
 * `weightGrams`, `series` or `notes`, so any helper may return null and the
 * caller renders nothing rather than a placeholder dash.
 */

function attr(item: CatalogItem, key: string): string | null {
  const value = item.attributes?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The source data's play-style field is free text with 20 distinct values
 * ("Power (beginner step-up)", "All-round / Speed"). Collapse to the leading
 * term for display. Display only — nothing branches on this.
 */
export function playStyleLabel(item: CatalogItem): string | null {
  const raw = attr(item, 'playStyle');
  if (!raw) return null;
  return raw.split('/')[0].split('(')[0].trim() || null;
}

/** "4U" + "83-88" -> "4U (83–88g)". Grams make the class self-explanatory. */
export function weightLabel(item: CatalogItem): string | null {
  const weight = attr(item, 'weight');
  if (!weight) return null;
  const grams = attr(item, 'weightGrams');
  if (!grams) return weight;
  return `${weight} (${grams.replace('-', '–')}g)`;
}

/** Two tiers, most-human first: plain language, then the spec sheet. */
export function specTiers(item: CatalogItem): { plain: string | null; specs: string | null } {
  const plain = [playStyleLabel(item), attr(item, 'balance')].filter(Boolean).join(' · ');
  const specs = [weightLabel(item), attr(item, 'flex')].filter(Boolean).join(' · ');
  return { plain: plain || null, specs: specs || null };
}

// Ordered light -> heavy. Combined classes ("4U/5U") take their first term.
const WEIGHT_ORDER = ['6U', '5U', '4U', '3U', '2U'];
const FLEX_ORDER = ['Flexible', 'Medium', 'Medium-Stiff', 'Stiff', 'Extra Stiff'];

function rank(order: string[], raw: string | null): number | null {
  if (!raw) return null;
  // Combined classes ("4U/5U", "5U/G6") take their first term. G6 is a grip
  // size, not a weight class, and must never be ranked as one.
  const head = raw.split('/')[0].trim().toLowerCase();
  const index = order.findIndex((o) => o.toLowerCase() === head);
  return index === -1 ? null : index;
}

/** light | heavy | even | null(unknown). Strips a leading "slightly ". */
function balanceClass(raw: string | null): 'light' | 'heavy' | 'even' | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase().replace(/^slightly\s+/, '');
  if (value.includes('head-light')) return 'light';
  if (value.includes('head-heavy')) return 'heavy';
  if (value === 'even') return 'even';
  return null;
}

/**
 * How a recommended racket differs from the one the player already has.
 * Returns an i18n key suffix, or null when there is nothing useful to say.
 *
 * First difference wins, in weight -> balance -> flex order: weight is the
 * most felt on court, flex the least. One phrase only — a card that lists
 * three deltas is a spec diff, not a nudge.
 */
export function compareRackets(mine: CatalogItem | null, theirs: CatalogItem): string | null {
  if (!mine) return null;

  const mineWeight = rank(WEIGHT_ORDER, attr(mine, 'weight'));
  const theirsWeight = rank(WEIGHT_ORDER, attr(theirs, 'weight'));
  if (mineWeight !== null && theirsWeight !== null && mineWeight !== theirsWeight) {
    return theirsWeight < mineWeight ? 'lighter' : 'heavier';
  }

  // Classify, never substring-match. `Even` contains no "light" (so a naive
  // test calls a neutral racket head-heavy), and "Slightly head-heavy"
  // contains "light" inside *slightly* (so it inverts). Both values are real
  // catalog data.
  const mineBalance = balanceClass(attr(mine, 'balance'));
  const theirsBalance = balanceClass(attr(theirs, 'balance'));
  // Only a definite, differing direction earns a phrase — `even` and unknown
  // fall through to flex, which is an honest difference we can name.
  if (
    (mineBalance === 'light' || mineBalance === 'heavy') &&
    (theirsBalance === 'light' || theirsBalance === 'heavy') &&
    mineBalance !== theirsBalance
  ) {
    return theirsBalance === 'light' ? 'moreHeadLight' : 'moreHeadHeavy';
  }

  const mineFlex = rank(FLEX_ORDER, attr(mine, 'flex'));
  const theirsFlex = rank(FLEX_ORDER, attr(theirs, 'flex'));
  if (mineFlex !== null && theirsFlex !== null && mineFlex !== theirsFlex) {
    return theirsFlex < mineFlex ? 'moreFlexible' : 'stiffer';
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/racket-specs.test.ts`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/racketSpecs.ts __tests__/racket-specs.test.ts
git commit -m "feat(equipment): pure racket spec display helpers"
```

---

### Task 3: Translation keys for the new card content

**Files:**
- Modify: `messages/en.json`, `messages/zh-CN.json`

**Interfaces:**
- Produces: `valueHub` keys `usingToday`, `compareLighter`, `compareHeavier`, `compareMoreHeadLight`, `compareMoreHeadHeavy`, `compareMoreFlexible`, `compareStiffer`, `searchPlaceholder`, `searchNoMatches`, `bagTitle`, `bagActive`, `bagSetActive`, `bagRemove`, `bagFull`, `bagDuplicate`

- [ ] **Step 1: Add the English keys**

In `messages/en.json`, inside the existing `valueHub` object:

```json
"usingToday": "What is the racket you are using today?",
"compareLighter": "Lighter than yours",
"compareHeavier": "Heavier than yours",
"compareMoreHeadLight": "More head-light than yours",
"compareMoreHeadHeavy": "More head-heavy than yours",
"compareMoreFlexible": "More flexible than yours",
"compareStiffer": "Stiffer than yours",
"searchPlaceholder": "Search rackets",
"searchNoMatches": "No rackets match that.",
"bagTitle": "Your bag",
"bagActive": "Using today",
"bagSetActive": "Use this one",
"bagRemove": "Remove",
"bagFull": "That's all the rackets we can hold — remove one first.",
"bagDuplicate": "That racket is already in your bag."
```

- [ ] **Step 2: Add the same keys to zh-CN**

In `messages/zh-CN.json`, inside `valueHub`:

```json
"usingToday": "你今天用的是哪支球拍？",
"compareLighter": "比你的更轻",
"compareHeavier": "比你的更重",
"compareMoreHeadLight": "比你的更头轻",
"compareMoreHeadHeavy": "比你的更头重",
"compareMoreFlexible": "比你的更软",
"compareStiffer": "比你的更硬",
"searchPlaceholder": "搜索球拍",
"searchNoMatches": "没有匹配的球拍。",
"bagTitle": "你的球包",
"bagActive": "今天在用",
"bagSetActive": "改用这支",
"bagRemove": "移除",
"bagFull": "球包已满 — 请先移除一支。",
"bagDuplicate": "这支球拍已经在你的球包里了。"
```

- [ ] **Step 3: Run the i18n parity test**

Run: `npx vitest run __tests__/i18n/locale-parity.test.ts`
Expected: PASS — both locales carry the same key set.

- [ ] **Step 4: Restart the dev server if one is running**

Adding keys inside an already-loaded namespace hot-reloads cleanly, so no restart is needed here. (A brand-new top-level namespace would require one — that trap is why these keys go under `valueHub`.)

- [ ] **Step 5: Commit**

```bash
git add messages/en.json messages/zh-CN.json
git commit -m "i18n(equipment): keys for bag view, search and spec comparison"
```

---

### Task 4: Hero racket card + stacked hierarchy

**Files:**
- Create: `components/stats/cards/YourRacketCard.tsx`
- Modify: `components/stats/RacketRow.tsx`
- Modify: `components/stats/cards/RacketRecCard.tsx`
- Test: `__tests__/components/YourRacketCard.test.tsx`

**Interfaces:**
- Consumes: `specTiers`, `compareRackets` from `lib/racketSpecs`
- Produces:
  - `<YourRacketCard item={CatalogItem | null} label={string | null} loading={boolean} error={boolean} onEdit={() => void} />`
  - `RacketRecCard` gains a required `mine: CatalogItem | null` prop

- [ ] **Step 1: Write the failing component test**

Create `__tests__/components/YourRacketCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import YourRacketCard from '../../components/stats/cards/YourRacketCard';
import enMessages from '../../messages/en.json';
import type { CatalogItem } from '../../lib/types';

afterEach(cleanup);

const ASTROX: CatalogItem = {
  id: 'racket-yonex-astrox-100zz', category: 'racket', brand: 'Yonex', model: 'Astrox 100ZZ',
  skillRange: [4, 6],
  attributes: { playStyle: 'Power', balance: 'Head-heavy', weight: '4U', weightGrams: '83-88', flex: 'Extra Stiff' },
};

function renderCard(props: Partial<React.ComponentProps<typeof YourRacketCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <YourRacketCard item={null} label={null} loading={false} error={false} onEdit={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('YourRacketCard', () => {
  it('always asks the question, answered or not', () => {
    renderCard();
    expect(screen.getByText('What is the racket you are using today?')).toBeTruthy();
  });

  it('leads with the model, then brand, then the two spec tiers', () => {
    renderCard({ item: ASTROX, label: 'Yonex Astrox 100ZZ' });
    expect(screen.getByText('Astrox 100ZZ')).toBeTruthy();
    expect(screen.getByText('Yonex')).toBeTruthy();
    expect(screen.getByText('Power · Head-heavy')).toBeTruthy();
    expect(screen.getByText('4U (83–88g) · Extra Stiff')).toBeTruthy();
  });

  // A legacy row has no weightGrams/playStyle. It must render without gaps.
  it('degrades by omission on a sparse legacy item', () => {
    const legacy: CatalogItem = {
      id: 'racket-yonex-astrox-88d-pro', category: 'racket', brand: 'Yonex', model: 'Astrox 88D Pro',
      skillRange: [4, 6], attributes: { weight: '4U', flex: 'stiff' },
    };
    renderCard({ item: legacy, label: 'Yonex Astrox 88D Pro' });
    expect(screen.getByText('4U · stiff')).toBeTruthy();
    expect(screen.queryByText(/undefined|null|·\s*$/)).toBeNull();
  });

  it('prompts when no racket is set', () => {
    renderCard();
    expect(screen.getByText('Tap to pick yours')).toBeTruthy();
  });

  // Lying-empty-state rule: a load failure must not look like "no racket yet".
  it('shows an error, not the empty prompt, when the load failed', () => {
    renderCard({ error: true });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
  });

  // The label is stored on the gear doc; the CatalogItem may be missing if the
  // catalogId dangles. Show the name rather than falling back to "no racket".
  it('falls back to the stored label when the catalog item is missing', () => {
    renderCard({ item: null, label: 'Some Discontinued Racket' });
    expect(screen.getByText('Some Discontinued Racket')).toBeTruthy();
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/components/YourRacketCard.test.tsx`
Expected: FAIL — cannot resolve `YourRacketCard`

- [ ] **Step 3: Write YourRacketCard**

Create `components/stats/cards/YourRacketCard.tsx`:

```tsx
'use client';
import { useTranslations } from 'next-intl';
import { specTiers } from '@/lib/racketSpecs';
import type { CatalogItem } from '@/lib/types';

interface Props {
  /** Resolved catalog row for the active racket. Null when unset OR when the
   *  stored catalogId no longer resolves (discontinued/removed row). */
  item: CatalogItem | null;
  /** Label stored on the gear doc. Survives a dangling catalogId. */
  label: string | null;
  loading: boolean;
  error: boolean;
  onEdit: () => void;
}

/**
 * The Equipment tab's lead card. The question is the permanent label in every
 * state — nothing reflows when the player answers it.
 *
 * Content is two tiers, most-human first (plain language, then the spec
 * sheet), because "4U · head-heavy · stiff" alone is precise and opaque to
 * anyone who doesn't already know rackets. See lib/racketSpecs.ts.
 */
export default function YourRacketCard({ item, label, loading, error, onEdit }: Props) {
  const t = useTranslations('valueHub');
  const { plain, specs } = item ? specTiers(item) : { plain: null, specs: null };

  return (
    <button
      type="button"
      onClick={onEdit}
      className="glass-card"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '100%', textAlign: 'left', cursor: 'pointer' }}
    >
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{t('usingToday')}</p>

      {error ? (
        <span className="field-error" role="alert">{t('recError')}</span>
      ) : loading ? (
        <span className="shimmer-line rounded-lg" style={{ height: 22, width: '70%' }} aria-hidden="true" />
      ) : label ? (
        <>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-stat)', fontWeight: 600, lineHeight: 1.2 }}>
            {item?.model ?? label}
          </span>
          {item?.brand && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{item.brand}</span>
          )}
          {plain && (
            <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', marginTop: 'var(--space-2)' }}>{plain}</span>
          )}
          {specs && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{specs}</span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>{t('noRacketYet')}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/YourRacketCard.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Rewrite RacketRow as a stack that resolves the catalog item**

Replace the render block and add a catalog fetch in `components/stats/RacketRow.tsx`. The card needs the item's *attributes*, and the gear doc stores only `catalogId` + `label`, so the catalog must be resolved here. Replace the component body's state, effects and JSX with:

```tsx
  const [catalogItem, setCatalogItem] = useState<CatalogItem | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(null);

  const loadGear = useCallback(() => {
    if (!activeName) return;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const gear = d.gear as PlayerGear | null;
        const racket = gear?.items?.find((i) => i.category === 'racket');
        setRacketLabel(racket?.label ?? null);
        setCatalogId(racket?.catalogId ?? null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => { setLoadError(true); setLoaded(true); });
  }, [activeName]);

  useEffect(() => { loadGear(); }, [loadGear]);

  // Resolve the catalog row so the card can show specs. A dangling catalogId
  // leaves catalogItem null and the card falls back to the stored label.
  useEffect(() => {
    if (!catalogId) { setCatalogItem(null); return; }
    let live = true;
    fetch(`${BASE}/api/equipment/catalog?category=racket`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const items = (d.items ?? []) as CatalogItem[];
        setCatalogItem(items.find((i) => i.id === catalogId) ?? null);
      })
      .catch(() => { if (live) setCatalogItem(null); });
    return () => { live = false; };
  }, [catalogId]);

  if (!activeName) return null;

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <YourRacketCard
          item={catalogItem}
          label={racketLabel}
          loading={!loaded}
          error={loadError}
          onEdit={() => setSheetOpen(true)}
        />
        <RacketRecCard name={activeName} mine={catalogItem} />
      </div>

      <GearSheet
        name={activeName}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={loadGear}
        currentLabel={racketLabel}
      />
    </>
  );
```

Add the imports `YourRacketCard` and `CatalogItem`, and update the file's docstring — it currently says "two cards side-by-side. Left = YOUR racket… Right = the recommendation", which is now wrong.

- [ ] **Step 6: Add the comparison line to RacketRecCard**

In `components/stats/cards/RacketRecCard.tsx`, accept `mine` and render one comparison phrase under the model. Change the signature to `({ name, mine }: { name: string; mine: CatalogItem | null })`, import `compareRackets`, remove `minHeight: 112` from both the `<div>` and `<button>` style objects (it existed only to match the grid's other column), and insert after `body`:

```tsx
  const comparison = item ? compareRackets(mine, item) : null;
  const compareLine = comparison ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>
      {item?.brand} · {t(`compare${comparison.charAt(0).toUpperCase()}${comparison.slice(1)}`)}
    </p>
  ) : item ? (
    <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', margin: 0 }}>{item.brand}</p>
  ) : null;
```

Render `{compareLine}` directly after `{body}` in both the non-interactive `<div>` branch and the interactive `<button>` branch.

- [ ] **Step 7: Run the affected tests**

Run: `npx vitest run __tests__/components/ __tests__/racket-specs.test.ts`
Expected: PASS. `RacketRecCard`'s existing tests need `mine={null}` added to their render calls — update them; with `mine` null the comparison is null and they render the brand line only.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add components/stats/ __tests__/components/
git commit -m "feat(equipment): stack the Equipment cards, lead with your racket"
```

---

### Task 5: Search in the picker

**Files:**
- Modify: `components/stats/GearSheet.tsx`
- Test: `__tests__/components/GearSheet.test.tsx`

**Interfaces:**
- Consumes: existing `catalog` state in `GearSheet`
- Produces: no new exports

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/components/GearSheet.test.tsx` (reuse its existing `CATALOG` fixture and render helper):

```tsx
describe('GearSheet search', () => {
  it('matches on model across every brand, ignoring the selected tab', async () => {
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'drivex' } });
    // DriveX is a Victor racket; the sheet opens on Yonex.
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  it('matches case-insensitively on brand', async () => {
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'VICTOR' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  // A search miss is not a broken screen.
  it('shows an empty state, not an error, when nothing matches', async () => {
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No rackets match that.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores brand browsing when the query is cleared', async () => {
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    const input = screen.getByPlaceholderText('Search rackets');
    fireEvent.change(input, { target: { value: 'drivex' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.queryByText('DriveX 9X')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/components/GearSheet.test.tsx`
Expected: FAIL — no element with placeholder `Search rackets`

- [ ] **Step 3: Add the search field and filter**

In `components/stats/GearSheet.tsx`, add `const [query, setQuery] = useState('');`, reset it in the `open` effect (`setQuery('')`), and replace the `models` memo:

```tsx
  // A query searches the WHOLE catalog and bypasses the brand tabs —
  // filtering within the selected brand would hide matches and read as broken.
  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.filter((c) => c.brand === brand);
    return catalog.filter((c) => {
      const series = typeof c.attributes?.series === 'string' ? c.attributes.series : '';
      return `${c.brand} ${c.model} ${series}`.toLowerCase().includes(q);
    });
  }, [catalog, brand, query]);
```

Render the input above the brand tabs, and dim the tabs while searching so it is visible that they are not in play:

```tsx
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="fs-md"
              style={{
                width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
              }}
            />
```

Wrap the existing brand-tab block so it only renders when `!query.trim()`, and add the no-match branch after the `<ul>`:

```tsx
            {loaded && !loadError && catalog.length > 0 && models.length === 0 && (
              <EmptyState>{t('searchNoMatches')}</EmptyState>
            )}
```

The list is not autofocused: autofocus opens the keyboard over the results and forces recall before the player has seen what is there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/components/GearSheet.test.tsx`
Expected: PASS — the 4 new cases plus the existing select/save cases.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: 0 errors. `components/stats` errors on token violations — no raw hex, no numeric `fontSize`.

- [ ] **Step 6: Commit**

```bash
git add components/stats/GearSheet.tsx __tests__/components/GearSheet.test.tsx
git commit -m "feat(equipment): search the racket catalog alongside brand tabs"
```

---

### Task 6: Phase 1 verification

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all green, roughly 1111 + 29 tests.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: See it in the app**

Run the app offline per `.claude/skills/run-badminton-app/` — the `NEXT_PUBLIC_BASE_PATH=/bpm` variable is mandatory or every API call 404s and the app shows a false offline state:

```bash
NEXT_PUBLIC_BASE_PATH=/bpm SEED_DEV_SCENARIO=fresh-thursday npm run dev
```

Sign in as `Lin` (PIN 2468), open Stats → Equipment, and confirm: the question card leads at hero weight; the recommendation sits below it with a comparison line; the picker searches; a sparse legacy racket renders without empty separators.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/equipment-bag-view
gh pr create --title "Equipment: 50-racket catalog, hero racket card, search" \
  --body "Implements phase 1 of docs/superpowers/specs/2026-08-17-equipment-bag-view-design.md"
```

---

# Phase 2 — Bag view

Tasks 7–10. Separate PR. Adds `PlayerGear.activeRacketId` and three server-merged verbs.

---

### Task 7: activeRacketId field and resolver

**Files:**
- Modify: `lib/types.ts:272-286` (the `PlayerGear` interface)
- Create: `lib/activeRacket.ts`
- Test: `__tests__/active-racket.test.ts`

**Interfaces:**
- Consumes: `PlayerGear`, `GearItem` from `lib/types`
- Produces: `activeRacket(gear: PlayerGear | null): GearItem | null`, `rackets(gear: PlayerGear | null): GearItem[]`

- [ ] **Step 1: Write the failing test**

Create `__tests__/active-racket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { activeRacket, rackets } from '../lib/activeRacket';
import type { PlayerGear, GearItem } from '../lib/types';

function item(id: string, category: GearItem['category'] = 'racket'): GearItem {
  return { id, catalogId: `racket-${id}`, category, label: `Label ${id}` };
}
function gear(items: GearItem[], activeRacketId?: string): PlayerGear {
  return { id: 'gear-m1', memberId: 'm1', items, activeRacketId, updatedAt: '2026-08-17T00:00:00Z' };
}

describe('activeRacket', () => {
  it('follows the pointer', () => {
    expect(activeRacket(gear([item('a'), item('b')], 'b'))?.id).toBe('b');
  });

  // Legacy docs predate the pointer — they must render exactly as before.
  it('falls back to the first racket when there is no pointer', () => {
    expect(activeRacket(gear([item('a'), item('b')]))?.id).toBe('a');
  });

  it('falls back when the pointer names a deleted item', () => {
    expect(activeRacket(gear([item('a')], 'gone'))?.id).toBe('a');
  });

  it('falls back when the pointer names a non-racket', () => {
    expect(activeRacket(gear([item('a'), item('s', 'string')], 's'))?.id).toBe('a');
  });

  it('returns null for empty or absent gear', () => {
    expect(activeRacket(gear([]))).toBeNull();
    expect(activeRacket(null)).toBeNull();
  });
});

describe('rackets', () => {
  it('returns only rackets, in insertion order', () => {
    expect(rackets(gear([item('a'), item('s', 'string'), item('b')])).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('returns an empty array for absent gear', () => {
    expect(rackets(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/active-racket.test.ts`
Expected: FAIL — cannot resolve `../lib/activeRacket`

- [ ] **Step 3: Add the field**

In `lib/types.ts`, inside `interface PlayerGear`, after `items`:

```ts
  /** Id of the GearItem the player is currently using. A pointer rather than
   *  an `active` flag per item: a flag lets two rackets both claim active with
   *  no tiebreak. Absent on every doc written before the bag shipped —
   *  readers fall back to the first racket (see lib/activeRacket.ts). */
  activeRacketId?: string;
```

- [ ] **Step 4: Write the resolver**

Create `lib/activeRacket.ts`:

```ts
import type { PlayerGear, GearItem } from './types';

/**
 * Read-tolerant resolution of a player's current racket, mirroring
 * normalizeBirdUsages(): new docs carry an explicit pointer, legacy docs
 * don't, and both must read correctly with no migration.
 */
export function rackets(gear: PlayerGear | null): GearItem[] {
  return (gear?.items ?? []).filter((i) => i.category === 'racket');
}

export function activeRacket(gear: PlayerGear | null): GearItem | null {
  const list = rackets(gear);
  if (list.length === 0) return null;
  const pointed = gear?.activeRacketId
    ? list.find((i) => i.id === gear.activeRacketId)
    : undefined;
  return pointed ?? list[0];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/active-racket.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/activeRacket.ts __tests__/active-racket.test.ts
git commit -m "feat(equipment): activeRacketId pointer with legacy-tolerant resolver"
```

---

### Task 8: POST / PATCH / DELETE verbs

**Files:**
- Modify: `app/api/equipment/gear/route.ts`
- Test: `__tests__/equipment-gear-bag.test.ts`

**Interfaces:**
- Consumes: `activeRacket`, `rackets` from `lib/activeRacket`; `memberCookieValue` from `__tests__/helpers`
- Produces:
  - `POST /api/equipment/gear` `{ name, item }` → `{ gear }` | 409 `bag_full` / `duplicate_racket`
  - `PATCH /api/equipment/gear` `{ name, activeRacketId }` → `{ gear }` | 404 `racket_not_found`
  - `DELETE /api/equipment/gear?name=&itemId=` → `{ gear }` | 404 `racket_not_found`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/equipment-gear-bag.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST, PATCH, DELETE, GET } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, memberCookieValue, makeRequest, makeGetRequest } from './helpers';
import type { PlayerGear } from '../lib/types';

const NAME = 'Lin';
const MEMBER_ID = 'member-lin';

// NOTE the argument order: makeRequest(method, url, body, headers) — method
// first. And memberCookieValue returns the bare cookie VALUE, so it must be
// prefixed with `member_session=`. makeRequest already assigns a unique
// X-Client-IP per call, so tests never need to set one by hand.
function bagRequest(method: string, body?: Record<string, unknown>) {
  return makeRequest(method, 'http://localhost/api/equipment/gear', body, {
    Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}`,
  });
}

function unauthedRequest(method: string, body?: Record<string, unknown>) {
  return makeRequest(method, 'http://localhost/api/equipment/gear', body);
}

async function readGear(): Promise<PlayerGear | null> {
  const res = await GET(makeGetRequest(`http://localhost/api/equipment/gear?name=${NAME}`));
  return (await res.json()).gear;
}

const RACKET_A = { catalogId: 'racket-yonex-astrox-100zz', category: 'racket', label: 'Yonex Astrox 100ZZ' };
const RACKET_B = { catalogId: 'racket-victor-drivex-9x', category: 'racket', label: 'Victor DriveX 9X' };

beforeEach(() => {
  resetMockStore();
  seedMember(NAME, { id: MEMBER_ID });
  process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
});

function deleteRequest(itemId: string) {
  return makeRequest('DELETE', `http://localhost/api/equipment/gear?name=${NAME}&itemId=${itemId}`,
    undefined, { Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}` });
}

describe('POST /api/equipment/gear', () => {
  it('appends without discarding the previous racket', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(2);
  });

  it('points at the first racket added, and does not move the pointer after', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const pointer = ((await first.json()).gear as PlayerGear).activeRacketId;
    expect(pointer).toBeTruthy();
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    expect((await readGear())?.activeRacketId).toBe(pointer);
  });

  it('rejects a racket already in the bag', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const res = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('duplicate_racket');
  });

  it('caps the bag at 10', async () => {
    for (let i = 0; i < 10; i += 1) {
      await POST(bagRequest('POST', { name: NAME, item: { ...RACKET_A, catalogId: `racket-${i}`, label: `R${i}` } }));
    }
    const res = await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('bag_full');
  });

  it('rejects a caller without the member cookie', async () => {
    const res = await POST(unauthedRequest('POST', { name: NAME, item: RACKET_A }));
    expect(res.status).toBe(401);
  });

  // The limiter is keyed on name+IP and is module-level in-memory state that
  // resetMockStore() does NOT clear. Every other test here gets a unique IP
  // from makeRequest and so never trips it; this one pins a dedicated IP that
  // no other test uses, so the count is its own.
  it('rate-limits a flood of bag writes from one IP', async () => {
    const pinned = { Cookie: `member_session=${memberCookieValue(NAME, MEMBER_ID)}`, 'X-Client-IP': '203.0.113.77' };
    let last = 200;
    for (let i = 0; i < 22; i += 1) {
      const res = await POST(makeRequest('POST', 'http://localhost/api/equipment/gear',
        { name: NAME, item: { ...RACKET_A, catalogId: `racket-flood-${i}`, label: `F${i}` } }, pinned));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe('PATCH /api/equipment/gear', () => {
  it('moves the pointer', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const second = await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const target = ((await second.json()).gear as PlayerGear).items[1].id;
    await PATCH(bagRequest('PATCH', { name: NAME, activeRacketId: target }));
    expect((await readGear())?.activeRacketId).toBe(target);
  });

  it('404s on an id that is not in the bag', async () => {
    await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const res = await PATCH(bagRequest('PATCH', { name: NAME, activeRacketId: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('rejects a caller without the member cookie', async () => {
    const res = await PATCH(unauthedRequest('PATCH', { name: NAME, activeRacketId: 'x' }));
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/equipment/gear', () => {
  it('removes one racket and leaves the rest', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const targetId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(targetId));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(1);
    expect(gear?.items[0].label).toBe(RACKET_B.label);
  });

  it('repoints when the active racket is removed', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    await POST(bagRequest('POST', { name: NAME, item: RACKET_B }));
    const activeId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(activeId));
    const gear = await readGear();
    expect(gear?.activeRacketId).toBe(gear?.items[0].id);
  });

  it('clears the pointer when the last racket goes', async () => {
    const first = await POST(bagRequest('POST', { name: NAME, item: RACKET_A }));
    const onlyId = ((await first.json()).gear as PlayerGear).items[0].id;
    await DELETE(deleteRequest(onlyId));
    const gear = await readGear();
    expect(gear?.items).toHaveLength(0);
    expect(gear?.activeRacketId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run __tests__/equipment-gear-bag.test.ts`
Expected: FAIL — `POST is not a function`

- [ ] **Step 3: Implement the three verbs**

In `app/api/equipment/gear/route.ts`, add above the handlers:

```ts
import { randomBytes } from 'crypto';
import { rackets } from '@/lib/activeRacket';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';

const MAX_RACKETS = 10;
const BAG_WRITES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Shared gate for the three bag verbs: rate limit, then member resolution,
 * then ownership. Rate limit comes first (Rule 4) so it cannot be bypassed by
 * an unauthorized caller, and nothing mutates before ownership passes.
 *
 * Keyed on name+IP rather than memberId+IP: the key must be computable before
 * the member lookup, or the limiter sits behind the DB call it exists to
 * protect.
 */
async function authorizeBagWrite(req: NextRequest, name: string) {
  const key = `gear-bag:${name.toLowerCase()}:${getClientIp(req)}`;
  if (!checkRateLimit(key, BAG_WRITES_PER_HOUR, HOUR_MS)) {
    return { error: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) };
  }
  const memberId = await resolveMemberId(name);
  if (!memberId) return { error: NextResponse.json({ error: 'member_not_found' }, { status: 404 }) };
  const caller = verifyMemberAuth(req);
  if (caller?.memberId !== memberId && !(await isAdminAuthedWithMember(req)).authed) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { memberId };
}

async function readGearDoc(memberId: string): Promise<PlayerGear | undefined> {
  const container = getContainer('playerGear');
  const { resource } = await container.item(`gear-${memberId}`, memberId).read();
  return resource as PlayerGear | undefined;
}

async function writeGearDoc(memberId: string, prior: PlayerGear | undefined, next: Partial<PlayerGear>) {
  const doc: PlayerGear = {
    id: `gear-${memberId}`,
    memberId,
    items: next.items ?? prior?.items ?? [],
    activeRacketId: 'activeRacketId' in next ? next.activeRacketId : prior?.activeRacketId,
    stringLog: prior?.stringLog,
    shoesMileageSessions: prior?.shoesMileageSessions,
    updatedAt: new Date().toISOString(),
  };
  const { resource } = await getContainer('playerGear').items.upsert(doc);
  return resource;
}
```

Then the handlers. Each reads fresh and merges server-side — the client never sends the whole array, so a failed read cannot wipe the bag:

```ts
export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!body.item || typeof body.item !== 'object') {
      return NextResponse.json({ error: 'item_required' }, { status: 400 });
    }
    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    const prior = await readGearDoc(auth.memberId);
    const existing = prior?.items ?? [];
    const catalogId = typeof body.item.catalogId === 'string' ? body.item.catalogId : null;

    if (catalogId && existing.some((i) => i.catalogId === catalogId)) {
      return NextResponse.json({ error: 'duplicate_racket' }, { status: 409 });
    }
    if (rackets(prior ?? null).length >= MAX_RACKETS) {
      return NextResponse.json({ error: 'bag_full' }, { status: 409 });
    }

    const incoming: GearItem = {
      id: randomBytes(12).toString('hex'),
      catalogId,
      category: body.item.category,
      label: String(body.item.label ?? '').slice(0, 80),
      acquiredAt: body.item.acquiredAt,
      notes: typeof body.item.notes === 'string' ? body.item.notes.slice(0, 200) : undefined,
    };

    const items = [...existing, incoming];
    // Only the first racket claims the pointer — adding never yanks the
    // player's current racket out from under them.
    const activeRacketId = prior?.activeRacketId
      ?? (incoming.category === 'racket' ? incoming.id : undefined);

    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { items, activeRacketId }) });
  } catch (error) {
    console.error('POST equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
    const activeRacketId = typeof body.activeRacketId === 'string' ? body.activeRacketId : '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!activeRacketId) return NextResponse.json({ error: 'active_racket_required' }, { status: 400 });

    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    const prior = await readGearDoc(auth.memberId);
    if (!rackets(prior ?? null).some((i) => i.id === activeRacketId)) {
      return NextResponse.json({ error: 'racket_not_found' }, { status: 404 });
    }
    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { activeRacketId }) });
  } catch (error) {
    console.error('PATCH equipment/gear error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    await ensureGear();
    const url = new URL(req.url);
    const name = url.searchParams.get('name')?.trim().slice(0, 50) ?? '';
    const itemId = url.searchParams.get('itemId') ?? '';
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 });
    if (!itemId) return NextResponse.json({ error: 'item_required' }, { status: 400 });

    const auth = await authorizeBagWrite(req, name);
    if (auth.error) return auth.error;

    const prior = await readGearDoc(auth.memberId);
    const existing = prior?.items ?? [];
    if (!existing.some((i) => i.id === itemId)) {
      return NextResponse.json({ error: 'racket_not_found' }, { status: 404 });
    }

    const items = existing.filter((i) => i.id !== itemId);
    // Removing the active racket must leave a coherent pointer, never one
    // aimed at a deleted item.
    const remainingRackets = items.filter((i) => i.category === 'racket');
    const activeRacketId = prior?.activeRacketId === itemId
      ? remainingRackets[0]?.id
      : prior?.activeRacketId;

    return NextResponse.json({ gear: await writeGearDoc(auth.memberId, prior, { items, activeRacketId }) });
  } catch (error) {
    console.error('DELETE equipment/gear error:', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/equipment-gear-bag.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Confirm the existing PUT still works**

Run: `npx vitest run __tests__/equipment-gear.test.ts`
Expected: PASS — `PUT` is untouched and still replaces same-category items.

- [ ] **Step 6: Commit**

```bash
git add app/api/equipment/gear/route.ts __tests__/equipment-gear-bag.test.ts
git commit -m "feat(equipment): server-merged POST/PATCH/DELETE for the racket bag"
```

---

### Task 9: Bag UI in the picker

**Files:**
- Create: `components/stats/BagList.tsx`
- Modify: `components/stats/GearSheet.tsx`
- Modify: `components/stats/RacketRow.tsx`
- Test: `__tests__/components/BagList.test.tsx`

**Interfaces:**
- Consumes: `rackets` from `lib/activeRacket`; `GearItem` from `lib/types`
- Produces: `<BagList items={GearItem[]} activeId={string | undefined} onActivate={(id: string) => void} onRemove={(id: string) => void} busy={boolean} />`

- [ ] **Step 1: Write the failing test**

Create `__tests__/components/BagList.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BagList from '../../components/stats/BagList';
import enMessages from '../../messages/en.json';
import type { GearItem } from '../../lib/types';

afterEach(cleanup);

const ITEMS: GearItem[] = [
  { id: 'a', catalogId: 'racket-a', category: 'racket', label: 'Yonex Astrox 100ZZ' },
  { id: 'b', catalogId: 'racket-b', category: 'racket', label: 'Victor DriveX 9X' },
];

function renderBag(props: Partial<React.ComponentProps<typeof BagList>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BagList items={ITEMS} activeId="a" onActivate={vi.fn()} onRemove={vi.fn()} busy={false} {...props} />
    </NextIntlClientProvider>,
  );
}

describe('BagList', () => {
  it('lists every racket and marks the active one', () => {
    renderBag();
    expect(screen.getByText('Yonex Astrox 100ZZ')).toBeTruthy();
    expect(screen.getByText('Victor DriveX 9X')).toBeTruthy();
    expect(screen.getByText('Using today')).toBeTruthy();
  });

  it('activates an inactive racket on tap', () => {
    const onActivate = vi.fn();
    renderBag({ onActivate });
    fireEvent.click(screen.getByLabelText('Use this one — Victor DriveX 9X'));
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  // Tapping the racket you are already using should do nothing, not re-POST.
  it('does not re-activate the racket already in use', () => {
    const onActivate = vi.fn();
    renderBag({ onActivate });
    expect(screen.queryByLabelText('Use this one — Yonex Astrox 100ZZ')).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('removes on tap', () => {
    const onRemove = vi.fn();
    renderBag({ onRemove });
    fireEvent.click(screen.getByLabelText('Remove — Victor DriveX 9X'));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  // Single-racket players see no bag — the experience is unchanged from today.
  it('renders nothing with fewer than two rackets', () => {
    const { container } = renderBag({ items: [ITEMS[0]] });
    expect(container.textContent).toBe('');
  });

  it('disables every action while a write is in flight', () => {
    renderBag({ busy: true });
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run __tests__/components/BagList.test.tsx`
Expected: FAIL — cannot resolve `BagList`

- [ ] **Step 3: Write BagList**

Create `components/stats/BagList.tsx`:

```tsx
'use client';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { GearItem } from '@/lib/types';

interface Props {
  items: GearItem[];
  activeId: string | undefined;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  busy: boolean;
}

/**
 * The player's racket bag, shown above the picker inside GearSheet.
 *
 * Hidden below two rackets: with one racket there is no choice to make, and a
 * "bag" of one is chrome. The single-racket experience is unchanged from
 * before the bag existed.
 */
export default function BagList({ items, activeId, onActivate, onRemove, busy }: Props) {
  const t = useTranslations('valueHub');
  if (items.length < 2) return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="section-label" style={{ margin: 0 }}>{t('bagTitle')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li
              key={item.id}
              className="cc-mini-card"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 12, borderRadius: 'var(--radius-lg)' }}
            >
              <span style={{ flex: 1, fontSize: 'var(--fs-md)' }}>{item.label}</span>
              {isActive ? (
                <StatusBadge variant="accent">{t('bagActive')}</StatusBadge>
              ) : (
                <button
                  type="button"
                  className="cc-btn cc-btn-ghost"
                  disabled={busy}
                  aria-label={`${t('bagSetActive')} — ${item.label}`}
                  onClick={() => onActivate(item.id)}
                >
                  {t('bagSetActive')}
                </button>
              )}
              <button
                type="button"
                className="cc-btn cc-btn-ghost"
                disabled={busy}
                aria-label={`${t('bagRemove')} — ${item.label}`}
                onClick={() => onRemove(item.id)}
              >
                <span className="material-icons" style={{ fontSize: 'var(--icon-sm)' }} aria-hidden="true">close</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/components/BagList.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Check the icon glyph is in the subset**

Run: `npx vitest run __tests__/icon-subset.test.ts`
Expected: PASS. `close` is already in the subset (used by `GearSheet`'s header). If it fails, add the glyph to the `icon_names=` URL in `app/layout.tsx` — a missing glyph renders as the literal text `CLOSE`.

- [ ] **Step 6: Wire the bag into GearSheet**

In `components/stats/GearSheet.tsx`: load the gear doc alongside the catalog, render `<BagList>` above the search input, switch `save()` from `PUT` to `POST`, and map the two 409 codes to their messages:

```tsx
      const res = await fetch(`${BASE}/api/equipment/gear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, item: { catalogId: selected.id, category: 'racket', label } }),
      });
      if (res.status === 409) {
        const { error } = await res.json();
        setSaveMessage(error === 'bag_full' ? t('bagFull') : t('bagDuplicate'));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
```

`setSaveMessage` is new state rendered through `<ErrorState>` — a 409 is a legible refusal, not a crash, and must not be swallowed into the generic save error.

Activate and remove call `PATCH` / `DELETE`, then re-read gear and call `onSaved()`. Both gate on `online` exactly as `save()` does.

- [ ] **Step 7: Point RacketRow at the resolver**

In `components/stats/RacketRow.tsx`, replace `gear?.items?.find((i) => i.category === 'racket')` with `activeRacket(gear)` from `lib/activeRacket`, so the hero card follows the pointer rather than the first item.

- [ ] **Step 8: Run the component suite**

Run: `npx vitest run __tests__/components/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add components/stats/ __tests__/components/BagList.test.tsx
git commit -m "feat(equipment): racket bag UI with activate and remove"
```

---

### Task 10: Phase 2 verification

- [ ] **Step 1: Full suite, types, lint**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green, 0 errors.

- [ ] **Step 2: Exercise the bag in the app**

```bash
NEXT_PUBLIC_BASE_PATH=/bpm SEED_DEV_SCENARIO=fresh-thursday npm run dev
```

Sign in as `Lin` (PIN 2468) → Stats → Equipment. Add a second racket and confirm the first is still there. Switch active and confirm the hero card follows. Remove the active one and confirm the pointer moves rather than leaving the card blank. Add a racket already in the bag and confirm the refusal message reads as a refusal, not a failure. Go offline (devtools) and confirm activate/remove are disabled with the banner, not silently broken.

- [ ] **Step 3: Verify legacy docs still read**

A gear doc written before this change has `items` but no `activeRacketId`. Confirm the resolver's fallback covers it:

Run: `npx vitest run __tests__/active-racket.test.ts`
Expected: PASS — the "falls back to the first racket when there is no pointer" case is the regression guard.

- [ ] **Step 4: Push and open the PR**

```bash
git push
gh pr create --title "Equipment: racket bag view" \
  --body "Implements phase 2 of docs/superpowers/specs/2026-08-17-equipment-bag-view-design.md"
```

---

## Self-review notes

**Spec coverage:** catalog import → Task 1. Hierarchy → Task 4. Card content two-tier + weightGrams + playStyle normalize → Tasks 2, 4. Rec comparison → Tasks 2, 4. Search → Task 5. `activeRacketId` + resolver → Task 7. Three verbs + rate limit + cap → Task 8. Bag UI → Task 9. Offline gating → Task 9 Step 6, verified Task 10 Step 2. i18n → Task 3.

**Deliberately deferred:** enriching the 4 overlapping rackets with the source file's deeper attributes (data edit, not code). `notes` on the card face (spec: belongs in picker rows) — not implemented in this plan; the field is imported and available.

**Known follow-up:** `RacketRow` and `GearSheet` both fetch `/api/equipment/catalog`. Acceptable duplication at this size; lift to a shared provider if a third consumer appears.
