# Racket Recommender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace a recommender that reads one rarely-set field with one that scores the fourteen skill ratings the check-in already collects, explains itself, and never suggests a racket the player owns.

**Architecture:** Four units with clean seams. `lib/racketProfile.ts` turns stored ratings + gear into a profile. `lib/racketRecommend.ts` is a pure port of the supplied Python scorer — no I/O, no clock, fully unit-testable. `app/api/recommend/route.ts` gates on a flag and wires them to Cosmos. `RacketRow` collects the two inputs skills cannot imply (format, budget) and `RacketRecCard` renders reasons.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest, Cosmos DB (mock store in tests), next-intl.

**Spec:** `docs/superpowers/specs/2026-08-19-racket-recommender-design.md`

## Global Constraints

- Flag name is exactly `NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER`; `'false'` in **both** `.github/workflows/deploy-next.yml` and `deploy-stable.yml`. Register in **three** places in `lib/flags.ts` (the `FlagName` union, the `FLAGS` registry, the `isFlagOn` switch) — Next only inlines literal `process.env.NEXT_PUBLIC_*` accesses.
- Read flags only via `isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')`. Only the literal string `'true'` means on.
- `USD_TO_CAD = 1.38` and `TIER_RANGE` (`Entry-level [1,3]`, `Mid-range [2,5]`, `Premium [4,6]`) are **reused verbatim** from `scripts/import-racket-database.mjs`. Do not introduce new values.
- `CatalogItem.category` is the Cosmos **partition key** and must always be the literal `'racket'`. The source file's `category` field is play style and goes in `attributes.playStyle`. The source's `partitionKey: "Yonex"` is dropped.
- Schema changes are additive-and-optional only — `bpm-stable` and `bpm-next` share one Cosmos database.
- Never `catch { setX([]) }`. A failed read renders an error state, never an empty result (lying-empty-state rule).
- New network-mutating UI gates on `useOnline()` — disable, never execute-then-break.
- `messages/en.json` and `messages/zh-CN.json` must be edited **as text**. Never round-trip through a JSON parser: `en.json` contains duplicate keys that a parse/serialize cycle silently collapses.
- Run `npx tsc --noEmit` before any push; vitest's surface is narrower than `next build`.

---

### Task 1: Import the v2 racket database into the catalog

**Files:**
- Create: `scripts/import-racket-db-v2.mjs`
- Modify: `scripts/data/equipment-catalog.json` (generated output, committed)
- Test: `__tests__/racket-db-v2-import.test.ts`

**Interfaces:**
- Consumes: `scripts/data/racket-database-v2.json` (already committed, 60 records).
- Produces: an `equipment-catalog.json` with **71** items where 39 existing ids gained normalized attributes, 21 ids are new, and 11 legacy ids are untouched.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/racket-db-v2-import.test.ts
import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import source from '../scripts/data/racket-database-v2.json';

const items = (catalog as { items: any[] }).items;

describe('v2 racket import', () => {
  it('merges by prefixed id rather than duplicating', () => {
    expect(items).toHaveLength(71);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const raw of source as any[]) {
      expect(ids).toContain(`racket-${raw.id}`);
    }
  });

  it('keeps category as the partition key and never the source play style', () => {
    for (const i of items) expect(i.category).toBe('racket');
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox.attributes.playStyle).toBe('Power');
    expect(astrox.attributes.partitionKey).toBeUndefined();
    expect((astrox as any).partitionKey).toBeUndefined();
  });

  it('carries the normalized fields the engine needs', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox.attributes.balance).toBe('Head-heavy');
    expect(astrox.attributes.flex).toBe('Extra Stiff');
    expect(astrox.attributes.tier).toBe('Premium');
    expect(astrox.attributes.weightMaxG).toBe(88);
    expect(astrox.skillRange).toEqual([4, 6]);
    expect(astrox.msrp).toBe(Math.round(220 * 1.38));
  });

  it('leaves the 11 legacy-only rackets in place', () => {
    const sourceIds = new Set((source as any[]).map((r) => `racket-${r.id}`));
    const legacy = items.filter((i) => !sourceIds.has(i.id));
    expect(legacy).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/racket-db-v2-import.test.ts`
Expected: FAIL — the catalog has 50 items, not 71.

- [ ] **Step 3: Write the importer**

```js
#!/usr/bin/env node
/**
 * Author-time import: merges scripts/data/racket-database-v2.json into
 * scripts/data/equipment-catalog.json. Run once; the OUTPUT is committed.
 * Not part of the runtime path.
 *
 * Union, never replace. Prefixing source ids with `racket-` makes 39 of the
 * 60 collide EXACTLY with existing ids, so "source wins on attributes,
 * nothing is orphaned" falls out of a Map insert. The other 11 existing
 * rackets have no v2 counterpart and are left untouched — every player's
 * gear.catalogId pointing at them keeps resolving.
 *
 * Separate from import-racket-database.mjs because the source schema differs
 * (priceMinUSD/priceMaxUSD numbers vs a "$220-250" string, weightMinG/MaxG vs
 * weightGrams). Constants are deliberately shared so the two can't price the
 * same racket differently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'data', 'racket-database-v2.json');
const TARGET = join(here, 'data', 'equipment-catalog.json');

const TIER_RANGE = {
  'Entry-level': [1, 3],
  'Mid-range': [2, 5],
  Premium: [4, 6],
};

const USD_TO_CAD = 1.38;

function mapRecord(raw) {
  const attributes = {};
  const put = (key, value) => {
    if (value !== undefined && value !== null && value !== '') attributes[key] = value;
  };
  put('series', raw.series);
  put('playStyle', raw.category); // play-style, NOT the partition key
  put('subType', raw.subType);
  put('balance', raw.balance);
  put('flex', raw.flex);
  put('weight', raw.weightClass);
  put('weightMinG', raw.weightMinG);
  put('weightMaxG', raw.weightMaxG);
  put('tier', raw.tier);
  put('frameMaterial', raw.frameMaterial);
  put('tensionMinLbs', raw.tensionMinLbs);
  put('tensionMaxLbs', raw.tensionMaxLbs);
  put('gripSize', raw.gripSize);
  put('priceMinUSD', raw.priceMinUSD);
  put('priceMaxUSD', raw.priceMaxUSD);
  put('lastVerified', raw.lastVerified);
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
  if (typeof raw.priceMinUSD === 'number') {
    item.msrp = Math.round(raw.priceMinUSD * USD_TO_CAD);
  }
  return item;
}

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const target = JSON.parse(readFileSync(TARGET, 'utf8'));

const byId = new Map(target.items.map((i) => [i.id, i]));
let merged = 0;
let added = 0;
for (const raw of source) {
  const mapped = mapRecord(raw);
  if (byId.has(mapped.id)) merged += 1;
  else added += 1;
  // v2 wins: it is the normalized data the engine scores on.
  byId.set(mapped.id, mapped);
}

target.items = [...byId.values()];
writeFileSync(TARGET, `${JSON.stringify(target, null, 2)}\n`);
console.log(`merged ${merged}, added ${added}, total ${target.items.length}`);
```

- [ ] **Step 4: Run the importer**

Run: `node scripts/import-racket-db-v2.mjs`
Expected: `merged 39, added 21, total 71`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/racket-db-v2-import.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add scripts/import-racket-db-v2.mjs scripts/data/equipment-catalog.json __tests__/racket-db-v2-import.test.ts
git commit -m "feat(equipment): import the normalized v2 racket database (71 rackets)"
```

---

### Task 2: Register the flag

**Files:**
- Modify: `lib/flags.ts`
- Modify: `.github/workflows/deploy-next.yml`
- Modify: `.github/workflows/deploy-stable.yml`
- Test: `__tests__/flags.test.ts`

**Interfaces:**
- Produces: `isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')`, consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `__tests__/flags.test.ts`:

```ts
  describe('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER', () => {
    it('is on only for the literal string "true"', () => {
      process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
      expect(isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')).toBe(true);
      for (const v of ['1', 'yes', 'TRUE', 'false', '']) {
        process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = v;
        expect(isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')).toBe(false);
      }
    });
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/flags.test.ts`
Expected: FAIL — TypeScript rejects the unknown `FlagName`.

- [ ] **Step 3: Register in all three places in `lib/flags.ts`**

Add to the `FlagName` union (alongside `| 'NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE'`):

```ts
  | 'NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER'
```

Add to the `FLAGS` registry:

```ts
  NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER: {
    description: 'Skill-scored racket recommendations. Off everywhere until compared against the #248 AI card on bpm-next.',
    plannedRemoval: '2026-11-19',
  },
```

Add to the `isFlagOn` switch:

```ts
    case 'NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER':
      return process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
```

- [ ] **Step 4: Add to both workflows**

In `.github/workflows/deploy-next.yml` and `.github/workflows/deploy-stable.yml`, beside the other `NEXT_PUBLIC_FLAG_*` entries:

```yaml
          NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER: 'false'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/flags.test.ts && node scripts/check-flag-sync.mjs`
Expected: PASS, and the flag-sync hook reports no drift.

- [ ] **Step 6: Commit**

```bash
git add lib/flags.ts .github/workflows/deploy-next.yml .github/workflows/deploy-stable.yml __tests__/flags.test.ts
git commit -m "feat(flags): register NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER (off everywhere)"
```

---

### Task 3: `lib/racketProfile.ts` — ratings + gear → profile

**Files:**
- Create: `lib/racketProfile.ts`
- Modify: `lib/types.ts` (add two optional `PlayerGear` fields)
- Test: `__tests__/racket-profile.test.ts`

**Interfaces:**
- Consumes: `Rating` from `lib/assessment.ts` (`{ skillKey: string; value: number; source?: 'self'|'peer'|'ai' }`), `PlayerGear` from `lib/types.ts`.
- Produces: `PlayerProfile` and `buildProfile`, both consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/racket-profile.test.ts
import { describe, it, expect } from 'vitest';
import { buildProfile } from '../lib/racketProfile';
import type { Rating } from '../lib/assessment';

const r = (skillKey: string, value: number): Rating => ({ skillKey, value, source: 'self' });

describe('buildProfile', () => {
  it('maps all fourteen app skill keys onto engine fields', () => {
    const ratings: Rating[] = [
      r('serves_returns', 1), r('net_play', 2), r('clears_lifts', 3), r('drops', 4),
      r('drives', 5), r('smashes', 1), r('grip_deception', 2),
      r('footwork_split_step', 3), r('court_coverage', 4), r('speed_stamina', 5),
      r('game_reading', 1), r('consistency', 2), r('rules_strategy', 3), r('training_mindset', 4),
    ];
    const p = buildProfile({ ratings, gear: null })!;
    expect(p.serves).toBe(1);
    expect(p.net_play).toBe(2);
    expect(p.clears).toBe(3);
    expect(p.drops).toBe(4);
    expect(p.drives).toBe(5);
    expect(p.smashes).toBe(1);
    expect(p.grip).toBe(2);
    expect(p.footwork).toBe(3);
    expect(p.court_coverage).toBe(4);
    expect(p.stamina).toBe(5);
    expect(p.game_reading).toBe(1);
    expect(p.consistency).toBe(2);
    expect(p.rules).toBe(3);
    expect(p.mindset).toBe(4);
  });

  it('defaults skills the player did not rate to 3', () => {
    // validateRatings accepts any subset of >=1 skill, so partial is normal.
    const p = buildProfile({ ratings: [r('smashes', 5)], gear: null })!;
    expect(p.smashes).toBe(5);
    expect(p.drops).toBe(3);
    expect(p.consistency).toBe(3);
  });

  it('returns null when there are no ratings at all', () => {
    expect(buildProfile({ ratings: [], gear: null })).toBeNull();
  });

  it('reads format, budget and current racket from gear', () => {
    const gear = {
      id: 'gear-m1', memberId: 'm1',
      items: [{ id: 'a', catalogId: 'racket-yonex-astrox-100zz', category: 'racket' as const, label: 'Yonex Astrox 100ZZ' }],
      activeRacketId: 'a',
      playFormat: 'singles' as const,
      budgetMaxCad: 200,
    };
    const p = buildProfile({ ratings: [r('smashes', 3)], gear })!;
    expect(p.format).toBe('singles');
    expect(p.budgetMaxCad).toBe(200);
    expect(p.currentRacketId).toBe('racket-yonex-astrox-100zz');
  });

  it('defaults format to both and leaves budget undefined when gear says nothing', () => {
    const p = buildProfile({ ratings: [r('smashes', 3)], gear: null })!;
    expect(p.format).toBe('both');
    expect(p.budgetMaxCad).toBeUndefined();
    expect(p.currentRacketId).toBeUndefined();
  });

  it('ignores unknown skill keys rather than throwing', () => {
    const p = buildProfile({ ratings: [r('smashes', 4), r('not_a_skill', 5)], gear: null })!;
    expect(p.smashes).toBe(4);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/racket-profile.test.ts`
Expected: FAIL — `lib/racketProfile.ts` does not exist.

- [ ] **Step 3: Add the two optional `PlayerGear` fields**

In `lib/types.ts`, inside `interface PlayerGear`, after `activeRacketId`:

```ts
  /** "I mostly play" — drives the recommender's format scorer. Absent = 'both'.
   *  Additive and optional: bpm-stable and bpm-next share one database. */
  playFormat?: 'singles' | 'doubles' | 'both';
  /** Upper spend bound in CAD. Absent = no preference; the budget scorer stays
   *  neutral rather than penalising. Never a hard filter (spec D6). */
  budgetMaxCad?: number;
```

- [ ] **Step 4: Write the implementation**

```ts
// lib/racketProfile.ts
import type { Rating } from './assessment';
import type { PlayerGear } from './types';
import { activeRacket } from './activeRacket';

/**
 * The recommender's view of a player. Field names follow the supplied scoring
 * engine, not the app's assessment keys — SKILL_MAP below is the single place
 * the two vocabularies meet.
 */
export interface PlayerProfile {
  serves: number; net_play: number; clears: number; drops: number;
  drives: number; smashes: number; grip: number;
  footwork: number; court_coverage: number; stamina: number;
  game_reading: number; consistency: number; rules: number; mindset: number;
  format: 'singles' | 'doubles' | 'both';
  budgetMaxCad?: number;
  currentRacketId?: string;
}

/** App assessment key -> engine profile field. The check-in's fourteen skills
 *  map 1:1; only the names differ. */
const SKILL_MAP: Record<string, keyof PlayerProfile> = {
  serves_returns: 'serves',
  net_play: 'net_play',
  clears_lifts: 'clears',
  drops: 'drops',
  drives: 'drives',
  smashes: 'smashes',
  grip_deception: 'grip',
  footwork_split_step: 'footwork',
  court_coverage: 'court_coverage',
  speed_stamina: 'stamina',
  game_reading: 'game_reading',
  consistency: 'consistency',
  rules_strategy: 'rules',
  training_mindset: 'mindset',
};

/** What an unrated skill counts as. Matches the engine's own defaults: a
 *  mid-scale 3 is "no signal", not "weak". */
const DEFAULT_SKILL = 3;

/**
 * Build a profile from the player's latest assessment and their gear doc.
 *
 * Returns **null** when there are no ratings at all. That is deliberate: with
 * no signal the engine would score fourteen 3s and emit a confident,
 * meaningless pick — the exact failure the redesign exists to remove. Callers
 * render a "do the check-in" state instead (spec D5).
 *
 * Partial ratings are normal, not an error: `validateRatings` in
 * app/api/assessments/route.ts accepts any subset of one or more skills.
 */
export function buildProfile(input: {
  ratings: Rating[];
  gear: PlayerGear | null;
}): PlayerProfile | null {
  if (!input.ratings || input.ratings.length === 0) return null;

  const profile: PlayerProfile = {
    serves: DEFAULT_SKILL, net_play: DEFAULT_SKILL, clears: DEFAULT_SKILL, drops: DEFAULT_SKILL,
    drives: DEFAULT_SKILL, smashes: DEFAULT_SKILL, grip: DEFAULT_SKILL,
    footwork: DEFAULT_SKILL, court_coverage: DEFAULT_SKILL, stamina: DEFAULT_SKILL,
    game_reading: DEFAULT_SKILL, consistency: DEFAULT_SKILL, rules: DEFAULT_SKILL, mindset: DEFAULT_SKILL,
    format: input.gear?.playFormat ?? 'both',
  };

  for (const rating of input.ratings) {
    const field = SKILL_MAP[rating.skillKey];
    if (!field) continue; // unknown key — ignore rather than throw
    if (typeof rating.value !== 'number') continue;
    (profile as unknown as Record<string, number>)[field] = rating.value;
  }

  if (typeof input.gear?.budgetMaxCad === 'number') profile.budgetMaxCad = input.gear.budgetMaxCad;
  const current = activeRacket(input.gear ?? null);
  if (current?.catalogId) profile.currentRacketId = current.catalogId;

  return profile;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/racket-profile.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/racketProfile.ts lib/types.ts __tests__/racket-profile.test.ts
git commit -m "feat(equipment): build a recommender profile from check-in ratings"
```

---

### Task 4: `lib/racketRecommend.ts` — the scoring engine

**Files:**
- Create: `lib/racketRecommend.ts`
- Test: `__tests__/racket-recommend.test.ts`

**Interfaces:**
- Consumes: `PlayerProfile` from Task 3, `CatalogItem` from `lib/types.ts`.
- Produces: `Recommendation` and `recommendRackets(profile, catalog, topN?)`, consumed by Task 5.

**Reference:** `docs/superpowers/reference/recommend_racket.py` is the source of truth for scorer behaviour and weights. Port it faithfully except for the two divergences below.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/racket-recommend.test.ts
import { describe, it, expect } from 'vitest';
import { recommendRackets } from '../lib/racketRecommend';
import type { PlayerProfile } from '../lib/racketProfile';
import type { CatalogItem } from '../lib/types';

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    serves: 3, net_play: 3, clears: 3, drops: 3, drives: 3, smashes: 3, grip: 3,
    footwork: 3, court_coverage: 3, stamina: 3,
    game_reading: 3, consistency: 3, rules: 3, mindset: 3,
    format: 'both', ...over,
  };
}

function racket(id: string, attrs: Record<string, string | number>, msrp = 150): CatalogItem {
  return {
    id, category: 'racket', brand: 'Test', model: id, msrp,
    skillRange: [2, 5], attributes: { tier: 'Mid-range', ...attrs },
  };
}

const HEAD_HEAVY = racket('hh', { balance: 'Head-heavy', flex: 'Medium', playStyle: 'Power', weightMaxG: 88 });
const HEAD_LIGHT = racket('hl', { balance: 'Head-light', flex: 'Medium', playStyle: 'Speed', weightMaxG: 83 });
const EVEN = racket('ev', { balance: 'Even', flex: 'Medium', playStyle: 'All-round', weightMaxG: 85 });

describe('recommendRackets', () => {
  it('ranks head-heavy first for a power-led player', () => {
    const p = profile({ smashes: 5, clears: 5, drives: 1, net_play: 1 });
    const out = recommendRackets(p, [HEAD_LIGHT, EVEN, HEAD_HEAVY]);
    expect(out[0].item.id).toBe('hh');
    expect(out[0].reasons.join(' ')).toMatch(/head-heavy/i);
  });

  it('ranks head-light first for a speed-led player', () => {
    const p = profile({ drives: 5, net_play: 5, smashes: 1, clears: 1 });
    const out = recommendRackets(p, [HEAD_HEAVY, EVEN, HEAD_LIGHT]);
    expect(out[0].item.id).toBe('hl');
  });

  it('warns and penalises a shaft stiffer than the player can load', () => {
    const stiff = racket('xs', { balance: 'Even', flex: 'Extra Stiff', playStyle: 'Power', weightMaxG: 85 });
    const p = profile({ consistency: 1, grip: 1, smashes: 1 });
    const out = recommendRackets(p, [stiff, EVEN]);
    expect(out[0].item.id).toBe('ev');
    const stiffRec = out.find((r) => r.item.id === 'xs')!;
    expect(stiffRec.warnings.join(' ')).toMatch(/demanding/i);
  });

  it('never recommends the racket the player already owns', () => {
    const p = profile({ currentRacketId: 'ev' });
    const out = recommendRackets(p, [EVEN]);
    expect(out).toHaveLength(0);
  });

  // Spec D6: prices are USD-derived and go stale. An over-budget racket must
  // sink, never vanish — a silent exclusion is invisible when the price is wrong.
  it('sinks an over-budget racket but does not remove it', () => {
    const pricey = racket('exp', { balance: 'Even', flex: 'Medium', playStyle: 'All-round', weightMaxG: 85 }, 500);
    const p = profile({ budgetMaxCad: 200 });
    const out = recommendRackets(p, [pricey, EVEN]);
    expect(out.map((r) => r.item.id)).toContain('exp');
    expect(out[0].item.id).toBe('ev');
  });

  // Spec D4: the 11 legacy rows lack normalized fields. Scoring them would
  // invent values the data does not have.
  it('skips rackets missing the normalized fields it scores on', () => {
    const legacy = { id: 'old', category: 'racket', brand: 'Old', model: 'Legacy', skillRange: [1, 6], attributes: { weight: '4U' } } as CatalogItem;
    const out = recommendRackets(profile(), [legacy, EVEN]);
    expect(out.map((r) => r.item.id)).toEqual(['ev']);
  });

  it('scores 0-100 and returns at most topN, best first', () => {
    const out = recommendRackets(profile(), [HEAD_HEAVY, HEAD_LIGHT, EVEN], 2);
    expect(out).toHaveLength(2);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    for (const r of out) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/racket-recommend.test.ts`
Expected: FAIL — `lib/racketRecommend.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Port each scorer from `docs/superpowers/reference/recommend_racket.py`. Read attributes off `item.attributes`; treat `playStyle` as the Python's `category` and `weightMaxG` as its `weightMaxG`.

Required structure:

```ts
// lib/racketRecommend.ts
import type { CatalogItem } from './types';
import type { PlayerProfile } from './racketProfile';

export interface Recommendation {
  item: CatalogItem;
  /** 0-100, normalized against the maximum weighted score. */
  score: number;
  reasons: string[];
  warnings: string[];
}

const FLEX_DEMAND: Record<string, number> = {
  Flexible: 1, Medium: 2, 'Medium-Stiff': 3, Stiff: 4, 'Extra Stiff': 5,
};

/** Flex is weighted highest because the wrong flex causes injury and
 *  frustration, not merely a mediocre match. Weights are the Python's. */
const WEIGHTS = {
  flex: 1.4, balance: 1.3, category: 1.2, format: 1.2,
  skillTier: 1.1, weight: 1.0, budget: 0.9,
};

/** Fields the scorers read. A row missing any of them cannot be scored
 *  honestly, so it is skipped rather than defaulted (spec D4). */
function isScorable(item: CatalogItem): boolean {
  const a = item.attributes ?? {};
  return typeof a.balance === 'string' && typeof a.flex === 'string' && typeof a.tier === 'string';
}
```

Then implement, each returning `{ score, reasons, warnings }`:

- `scoreFlex` — `FLEX_DEMAND[flex]` vs a ceiling from `(consistency + grip + smashes) / 3`: `<=2 → 2`, `<=3 → 3`, `<=4 → 4`, else `5`. Over ceiling: `-8 * gap` plus a warning naming the flex and the player's consistency. Equal: `10` plus "matches your technique level". One below: `7` plus "gives you comfortable headroom". Otherwise `3`.
- `scoreBalance` — `powerBias = (smashes + clears)/2 - (drives + net_play)/2`. `>= 0.5` → Head-heavy `10` (reason names smashes and clears), Even `5`, else `1`. `<= -0.5` → Head-light `10` (reason names drives and net play), Even `5`, else `1`. Otherwise Even `10`, else `6`.
- `scoreWeight` — `endurance = (stamina + footwork)/2`, `wmax = attributes.weightMaxG ?? 85`. `<= 2.5`: `wmax <= 84` → `10` plus a reason, else `-3` plus a warning naming stamina and footwork. `>= 4.0`: `wmax >= 85 ? 8 : 6`. Otherwise `wmax <= 88 ? 7 : 4`.
- `scoreCategory` — scores `{ Power: (smashes+clears)/2, Speed: (drives+net_play)/2, Control: (drops+grip+game_reading)/3, 'All-round': technical }` where `technical` is the mean of the seven technical skills. If `max - min < 0.6`: `All-round → 10` plus a reason, else `6`. Else matching best → `10` plus a reason naming the category and score; `All-round → 6`; else `3`.
- `scoreFormat` — `doubles`: `subType === 'doubles'` → `10`; Head-light → `8`; Even → `5`; else `2`. `singles`: Head-heavy → `9`; Even → `7`; else `4`. `both`: Even or `subType === 'all-round'` or `playStyle === 'All-round'` → `9`; else `6`.
- `scoreSkillTier` — from `profile` overall (mean of the three category means): `< 2.5` Beginner, `< 3.75` Intermediate, else Advanced. Use the Python's 9-cell fit table. `>= 10` adds a reason; `< 0` adds a warning.
- `scoreBudget` — **never filters** (D6). No `budgetMaxCad` or no `msrp` → `5`. Else `ratio = msrp / budgetMaxCad`: `> 1` → `-20`; `>= 0.6` → `10` plus "Good use of your $N budget"; `>= 0.35` → `7`; else `4`.

`recommendRackets` filters out non-`racket` categories, non-scorable rows, and `profile.currentRacketId`; scores the rest; normalizes `max(0, total) / (10 * sum(weights)) * 100` rounded to one decimal; sorts descending; slices to `topN` (default 5).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/racket-recommend.test.ts && npx tsc --noEmit`
Expected: PASS (7 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/racketRecommend.ts __tests__/racket-recommend.test.ts
git commit -m "feat(equipment): port the 7-dimension racket scoring engine"
```

---

### Task 5: Wire the route behind the flag, with the privacy gate

**Files:**
- Modify: `app/api/recommend/route.ts`
- Test: `__tests__/recommend-route.test.ts`

**Interfaces:**
- Consumes: `buildProfile` (Task 3), `recommendRackets` (Task 4), `isFlagOn` (Task 2).
- Produces: `GET /api/recommend?name=X` → `{ item, reason, reasons, warnings, needsCheckIn }`.

**Spec D8 — this is the security-critical task.** The flag-on branch returns reasons that quote the player's individual skill ratings ("smash 3/5"). The route is currently unauthenticated and member names are enumerable via `GET /api/members`, so the flag-on branch MUST gate. The flag-off branch keeps today's public behaviour, which still leaks nothing.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/recommend-route.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '../app/api/recommend/route';
import { resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

const BASE = 'http://localhost:3000/api/recommend';

function getAs(name: string, cookieName?: string) {
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, {
    Cookie: `member_session=${memberCookieValue(cookieName ?? name)}`,
  });
}

function seedAssessment(memberId: string, name: string, ratings: { skillKey: string; value: number }[]) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({
    id: `a-${Math.random().toString(36).slice(2)}`, memberId, name,
    ratings: ratings.map((r) => ({ ...r, source: 'self' })),
    takenAt: '2026-06-01T00:00:00.000Z', overall: 3,
  });
}

describe('/api/recommend with the engine flag on', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  // D8: reasons quote private per-skill ratings, so this must not be public.
  it('403s without a member cookie, so skill ratings cannot be probed by name', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it('403s when the member cookie belongs to someone else', async () => {
    seedMember('Lin');
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns needsCheckIn rather than guessing when there is no assessment', async () => {
    seedMember('Lin');
    const body = await (await GET(getAs('Lin'))).json();
    expect(body.needsCheckIn).toBe(true);
    expect(body.item).toBeNull();
  });

  it('returns a pick with reasons for a rated player', async () => {
    const m = seedMember('Lin');
    seedAssessment(m.id, 'Lin', [
      { skillKey: 'smashes', value: 5 }, { skillKey: 'clears_lifts', value: 5 },
      { skillKey: 'drives', value: 1 }, { skillKey: 'net_play', value: 1 },
    ]);
    const body = await (await GET(getAs('Lin'))).json();
    expect(body.needsCheckIn).toBeFalsy();
    expect(body.item).toBeTruthy();
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it('keeps the old public behaviour when the engine flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'false';
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reasons).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/recommend-route.test.ts`
Expected: FAIL — no gate, no `needsCheckIn`.

- [ ] **Step 3: Implement the flag-on branch**

Add imports: `isAdminAuthed, verifyMemberAuth` from `@/lib/auth`, `buildProfile` from `@/lib/racketProfile`, `recommendRackets` from `@/lib/racketRecommend`, `getContainer` (already present).

Inside `GET`, after `name` is read and before the existing stage logic:

```ts
    if (isFlagOn('NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER')) {
      // D8 privacy gate: engine reasons quote the player's individual skill
      // ratings ("smash 3/5"), and member names are enumerable via
      // GET /api/members. The flag-off branch below stays public because it
      // returns only a coarse stage-derived pick.
      const member = verifyMemberAuth(req);
      const ownsName = member?.name?.trim().toLowerCase() === name.toLowerCase();
      if (!name || (!ownsName && !isAdminAuthed(req))) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }

      const subject = await resolveSubject(name);
      const { resources: assessments } = await getContainer('assessments').items
        .query({
          query: 'SELECT c.memberId, c.takenAt, c.ratings FROM c WHERE c.memberId = @memberId',
          parameters: [{ name: '@memberId', value: subject.memberId }],
        })
        .fetchAll();
      const latest = (assessments as { memberId?: string; takenAt?: string; ratings?: unknown }[])
        .filter((a) => a && a.memberId === subject.memberId && typeof a.takenAt === 'string')
        .sort((a, b) => (a.takenAt! < b.takenAt! ? 1 : -1))[0];

      const { resource: gear } = await getContainer('playerGear')
        .item(`gear-${subject.memberId}`, subject.memberId)
        .read()
        .catch(() => ({ resource: null }));

      const profile = buildProfile({
        ratings: (latest?.ratings as Rating[]) ?? [],
        gear: (gear as PlayerGear | null) ?? null,
      });
      // D5: no ratings -> say so rather than score fourteen 3s and emit a
      // confident, meaningless pick.
      if (!profile) {
        return NextResponse.json({ item: null, reason: null, needsCheckIn: true });
      }

      const catalogItems = (await getContainer('equipmentCatalog').items
        .query({
          query: 'SELECT * FROM c WHERE c.category = @category',
          parameters: [{ name: '@category', value: 'racket' }],
        })
        .fetchAll()).resources as CatalogItem[];

      const top = recommendRackets(profile, catalogItems, 1)[0];
      if (!top) return NextResponse.json({ item: null, reason: null });
      return NextResponse.json({
        item: top.item,
        reason: top.reasons[0] ?? null,
        reasons: top.reasons,
        warnings: top.warnings,
      });
    }
```

The gear read above matches `app/api/equipment/gear/route.ts:64` exactly — container `playerGear`, doc id `gear-<memberId>`, partition key the bare `memberId`. It also calls `ensureContainer('playerGear', '/memberId')` first (line 20); do the same here, since a route that has never run leaves the container absent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/recommend-route.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/recommend/route.ts __tests__/recommend-route.test.ts
git commit -m "feat(equipment): serve skill-scored recommendations behind an auth gate"
```

---

### Task 6: Collect format and budget in the Equipment tab

**Files:**
- Modify: `components/stats/RacketRow.tsx`
- Modify: `components/stats/useGear.ts`
- Modify: `app/api/equipment/gear/route.ts`
- Modify: `messages/en.json`, `messages/zh-CN.json`
- Test: `__tests__/components/RacketRow.test.tsx`, `__tests__/equipment-gear-prefs.test.ts`

**Interfaces:**
- Consumes: `useGear` from `components/stats/useGear.ts`.
- Produces: `PATCH /api/equipment/gear` accepting `{ name, playFormat }` and `{ name, budgetMaxCad }`; `useGear` gains `setPrefs(prefs)`.

- [ ] **Step 1: Write the failing API test**

```ts
// __tests__/equipment-gear-prefs.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH, GET } from '../app/api/equipment/gear/route';
import { resetMockStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

const BASE = 'http://localhost:3000/api/equipment/gear';

describe('gear preferences', () => {
  beforeEach(() => { resetMockStore(); setupAdminPin(); });

  it('persists playFormat and budgetMaxCad', async () => {
    seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', playFormat: 'doubles' }, cookie));
    await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: 200 }, cookie));
    const body = await (await GET(makeRequest('GET', `${BASE}?name=Lin`, undefined, cookie))).json();
    expect(body.gear.playFormat).toBe('doubles');
    expect(body.gear.budgetMaxCad).toBe(200);
  });

  it('rejects an unknown playFormat rather than storing it', async () => {
    seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    const res = await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', playFormat: 'mixed' }, cookie));
    expect(res.status).toBe(400);
  });

  it('rejects a negative or absurd budget', async () => {
    seedMember('Lin');
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
    expect((await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: -5 }, cookie))).status).toBe(400);
    expect((await PATCH(makeRequest('PATCH', BASE, { name: 'Lin', budgetMaxCad: 99999 }, cookie))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/equipment-gear-prefs.test.ts`
Expected: FAIL — PATCH ignores both fields.

- [ ] **Step 3: Accept the fields in the PATCH handler**

In `app/api/equipment/gear/route.ts`'s `PATCH`, alongside the existing `activeRacketId` branch. Keep the existing auth gate — these are member-scoped writes (Security Rule 12).

```ts
    const FORMATS = ['singles', 'doubles', 'both'] as const;
    const next: Partial<PlayerGear> = {};
    if ('playFormat' in body) {
      if (!FORMATS.includes(body.playFormat)) {
        return NextResponse.json({ error: 'invalid_format' }, { status: 400 });
      }
      next.playFormat = body.playFormat;
    }
    if ('budgetMaxCad' in body) {
      const v = body.budgetMaxCad;
      // Bounded so a typo can't store a value that silently disables the
      // budget scorer for everything.
      if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 5000)) {
        return NextResponse.json({ error: 'invalid_budget' }, { status: 400 });
      }
      next.budgetMaxCad = v ?? undefined;
    }
```

Merge `next` into the written doc the same way `activeRacketId` is merged.

- [ ] **Step 4: Add `setPrefs` to `useGear`**

```ts
  const setPrefs = useCallback((prefs: { playFormat?: 'singles'|'doubles'|'both'; budgetMaxCad?: number | null }) =>
    mutate(() => fetch(`${BASE}/api/equipment/gear`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...prefs }),
    })), [mutate, name]);
```

Add `setPrefs` to the `UseGear` interface and the returned object.

- [ ] **Step 5: Add the two controls to `RacketRow`**

Render above `RacketRecCard`, using the canonical segment-control contract — the wrapper needs `flex`, each tab `flex-1 flex items-center justify-center`:

```tsx
<section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
  <p className="section-label" style={{ margin: 0 }}>{t('formatLabel')}</p>
  <div className="segment-control flex" role="tablist" aria-label={t('formatLabel')}>
    {(['doubles', 'singles', 'both'] as const).map((f) => (
      <button
        key={f}
        type="button"
        role="tab"
        aria-selected={(gear.gear?.playFormat ?? 'both') === f}
        disabled={gear.busy}
        className={`flex-1 flex items-center justify-center fs-sm ${(gear.gear?.playFormat ?? 'both') === f ? 'segment-tab-active' : 'segment-tab-inactive'}`}
        onClick={() => runAction(gear.setPrefs({ playFormat: f }))}
      >
        {t(`format_${f}`)}
      </button>
    ))}
  </div>
</section>
```

Budget uses the same shape with bands mapping to `budgetMaxCad`: `100`, `200`, `350`, and `null` for no limit.

- [ ] **Step 6: Add i18n keys**

Edit `messages/en.json` and `messages/zh-CN.json` **as text** — never through a JSON parser. Add to `valueHub`:

```
"formatLabel": "I mostly play",       "budgetLabel": "Budget",
"format_doubles": "Doubles",          "budget_100": "Under $100",
"format_singles": "Singles",          "budget_200": "$100–200",
"format_both": "Both",                "budget_350": "$200–350",
                                      "budget_none": "No limit",
"needsCheckIn": "Do the check-in and we'll suggest a racket."
```

Chinese: `"我主要打"`, `"预算"`, `"双打"`, `"单打"`, `"都打"`, `"$100 以下"`, `"$100–200"`, `"$200–350"`, `"不限"`, `"做个自评，我们就能推荐球拍。"`

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run __tests__/equipment-gear-prefs.test.ts __tests__/components/RacketRow.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean, i18n parity test still green.

- [ ] **Step 8: Commit**

```bash
git add components/stats/RacketRow.tsx components/stats/useGear.ts app/api/equipment/gear/route.ts messages/en.json messages/zh-CN.json __tests__/
git commit -m "feat(equipment): collect play format and budget for the recommender"
```

---

### Task 7: Render reasons, warnings and the check-in prompt

**Files:**
- Modify: `components/stats/cards/RacketRecCard.tsx`
- Test: `__tests__/components/RacketRecCard.test.tsx`

**Interfaces:**
- Consumes: `GET /api/recommend` response `{ item, reason, reasons, warnings, needsCheckIn }` (Task 5).

**Coordination:** `RacketRecCard.tsx` is **PR #248's file**. Merge or close #248 before starting this task, or rebase onto it — do not edit both in parallel.

- [ ] **Step 1: Write the failing test**

```tsx
// add to __tests__/components/RacketRecCard.test.tsx
it('lists every reason and warning when the engine supplies them', async () => {
  mockFetch({
    item: { id: 'r1', category: 'racket', brand: 'Yonex', model: 'ArcSaber 7 Pro', skillRange: [2, 5], attributes: {} },
    reason: 'Even balance suits your all-round game',
    reasons: ['Even balance suits your all-round game', 'Mid-range tier matches your intermediate skill level'],
    warnings: ['At up to 88g this may tire your arm'],
  });
  render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
  fireEvent.click(await screen.findByRole('button'));
  expect(screen.getByText(/Mid-range tier matches/)).toBeTruthy();
  expect(screen.getByText(/may tire your arm/)).toBeTruthy();
});

it('prompts for the check-in instead of inventing a pick', async () => {
  mockFetch({ item: null, reason: null, needsCheckIn: true });
  render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
  expect(await screen.findByText(/Do the check-in/)).toBeTruthy();
});

// Unknown is not known-false: a 403 means the session expired, not "no pick".
it('shows an actionable state on 403 rather than an empty recommendation', async () => {
  global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) as unknown as typeof fetch;
  render(<Wrapper><RacketRecCard name="Lin" mine={null} /></Wrapper>);
  expect(await screen.findByRole('alert')).toBeTruthy();
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run __tests__/components/RacketRecCard.test.tsx`
Expected: FAIL — the card renders only `reason`.

- [ ] **Step 3: Implement the three states**

- Keep the existing single `reason` for the flag-off shape.
- When `reasons` is present, render each as a `+` line and each `warnings` entry as a `!` line inside the existing expand.
- `needsCheckIn` renders `t('needsCheckIn')` as body copy, and the card stays a plain `<div>` — there is nothing to expand (the existing conditional-interactivity rule).
- A `403` sets a distinct error state rendering `ErrorState`, not the empty state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/components/RacketRecCard.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add components/stats/cards/RacketRecCard.tsx __tests__/components/RacketRecCard.test.tsx
git commit -m "feat(equipment): render recommendation reasons, warnings and check-in prompt"
```

---

### Task 8: Verify end to end

**Files:** none — verification only.

- [ ] **Step 1: Full suite, typecheck, lint**

```bash
npm test && npx tsc --noEmit && npm run lint
```
Expected: all green, `0 errors` from lint.

- [ ] **Step 2: Mutation-test the two load-bearing guards**

Removing the D8 auth gate must fail the two 403 tests. Removing the `!profile` early return must fail the `needsCheckIn` test. If either still passes, the test is pinning the wrong thing — fix the test, not the code.

- [ ] **Step 3: Localhost pass**

```bash
COSMOS_CONNECTION_STRING= NEXT_PUBLIC_BASE_PATH=/bpm \
SEED_DEV_SCENARIO=fresh-thursday SEED_DEV_ADMIN=Grant:1234 \
NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE=true NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER=true \
npm run dev
```

On `localhost:3000/bpm` → Stats → Equipment, signed in as Lin (PIN 2468):

1. No assessment → card reads "Do the check-in…", not a racket.
2. Complete the check-in → a pick appears with at least one reason.
3. Change format doubles → singles → the pick or its reasons change.
4. Set budget under $100 → an expensive pick is displaced, not erased.
5. Add the recommended racket to the bag → it is no longer recommended.
6. Toggle offline → both controls disable, banner explains why.

- [ ] **Step 4: Commit any fixes, then open the PR**

Flag stays `'false'` in both workflows. Note in the PR that #248 remains open per spec D2, and that Task 7 touches its file.

---

## Self-review

**Spec coverage:** D1 → Task 6. D2 → Task 2 (flag off both workflows). D3 → Task 7. D4 → Task 4 (`isScorable`). D5 → Tasks 3, 5, 7. D6 → Task 4 (budget sinks, never filters). D7 → Task 1 (`USD_TO_CAD`). D8 → Task 5. Catalog merge → Task 1. Storage → Task 3. `racketProfile` → Task 3. `racketRecommend` → Task 4. Route → Task 5. UI → Tasks 6, 7. Error handling → Tasks 5, 7. Testing → every task, plus Task 8.

**Type consistency:** `PlayerProfile` fields are identical in Tasks 3 and 4. `Recommendation { item, score, reasons, warnings }` is defined in Task 4 and consumed unchanged in Tasks 5 and 7. `buildProfile` returns `PlayerProfile | null` in Task 3 and Task 5 branches on exactly that null. `playFormat` / `budgetMaxCad` are spelled identically in Tasks 3, 5 and 6.

**Resolved during review:** Task 5's gear read initially left the container name to the implementer. Confirmed against `app/api/equipment/gear/route.ts:20,64` and written into the task — `playerGear`, id `gear-<memberId>`, partition key `memberId`, preceded by `ensureContainer('playerGear', '/memberId')`. No guesses remain in the plan.
