import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recommendFit, fitLevel, isScorable, canon, FIT_ENGINE_VERSION, type FitInput } from '../lib/racketFit';
import { buildProfile } from '../lib/racketProfile';
import { activeRacket, rackets } from '../lib/activeRacket';
import type { CatalogItem, PlayerGear } from '../lib/types';
import type { Rating } from '../lib/assessment';

/**
 * The golden set — the expert half of the plan's staged ground truth
 * (`docs/plans/racket-fit-engine.md`). Cases are recorded as RAW ratings and a
 * gear shape, never a derived level, so this runs the real
 * `buildProfile → recommendFit` path and cannot drift from production.
 *
 * Skips loudly while empty. Phase 4 flips the guard to a hard `>= 5` — the
 * kill criterion reads that number.
 */
interface GoldenCase {
  id: string;
  note: string;
  ratedBy: string;
  ratedAt: string;
  gear: Partial<PlayerGear> & { activeCatalogId?: string };
  ratings: Rating[];
  acceptable: string[];
  unacceptable?: string[];
}
interface Golden { engineVersion: string; catalog: string; cases: GoldenCase[] }

const golden = JSON.parse(readFileSync(join(process.cwd(), '__tests__/fixtures/fit-golden.json'), 'utf8')) as Golden;
const catalogFile = JSON.parse(readFileSync(join(process.cwd(), golden.catalog), 'utf8')) as { items?: CatalogItem[] } | CatalogItem[];
const catalog = (Array.isArray(catalogFile) ? catalogFile : catalogFile.items ?? []).filter((i) => i.category === 'racket');
const ids = new Set(catalog.map((i) => i.id));

function toInput(c: GoldenCase): FitInput {
  const items = (c.gear.items ?? []).map((i, n) => ({ ...i, id: i.id ?? `i${n}`, category: i.category ?? ('racket' as const), label: i.label ?? '', catalogId: i.catalogId ?? null }));
  const activeId = c.gear.activeCatalogId ? items.find((i) => i.catalogId === c.gear.activeCatalogId)?.id : undefined;
  const gear = { id: 'g', memberId: 'm', updatedAt: '', ...c.gear, items, activeRacketId: activeId } as PlayerGear;
  const profile = buildProfile({ ratings: c.ratings, gear });
  const active = activeRacket(gear);
  const anchorRow = active?.catalogId ? catalog.find((r) => r.id === active.catalogId) ?? null : null;
  const owned = rackets(gear);
  return {
    anchor: anchorRow && isScorable(anchorRow) ? anchorRow : null,
    ownedIds: new Set(owned.map((i) => i.catalogId).filter((x): x is string => typeof x === 'string')),
    ownedLabels: new Set(owned.map((i) => canon(i.label))),
    goal: gear.fitGoal, swing: gear.fitSwing, armComfort: gear.fitArmComfort, grip: gear.fitGrip,
    format: gear.playFormat ?? 'both',
    budgetMaxCad: gear.budgetMaxCad,
    level: profile ? fitLevel(profile) : null,
    hasRatings: c.ratings.length > 0,
  };
}

describe('golden set — the engine version matches the fixture', () => {
  it('fixture was rated against the engine that is running', () => {
    expect(golden.engineVersion).toBe(FIT_ENGINE_VERSION);
  });
  it('is populated (Phase 4 raises this to >= 5; until then it only reports)', () => {
    if (golden.cases.length === 0) {
      console.warn('[fit-golden] no cases yet — the expert golden set is empty. See docs/plans/racket-fit-engine.md.');
    }
    expect(golden.cases.length).toBeGreaterThanOrEqual(0);
  });
});

describe.skipIf(golden.cases.length === 0)('golden set — every expert-rated case', () => {
  it.each(golden.cases.map((c) => [c.id, c] as const))('%s: top three intersects acceptable, avoids unacceptable', (_id, c) => {
    for (const id of [...c.acceptable, ...(c.unacceptable ?? [])]) {
      expect(ids.has(id), `${c.id} names an id the catalog does not have: ${id}`).toBe(true);
    }
    for (const i of c.gear.items ?? []) {
      if (i.catalogId) expect(ids.has(i.catalogId), `${c.id} owns an id the catalog does not have: ${i.catalogId}`).toBe(true);
    }
    const r = recommendFit(toInput(c), catalog);
    expect(r.top, `${c.id} produced no pick (${r.fitState})`).not.toBeNull();
    const top3 = [r.top!.item.id, ...r.alternatives.map((a) => a.item.id)];
    expect(top3.some((id) => c.acceptable.includes(id)), `${c.id}: top three ${top3.join(', ')} misses every acceptable pick`).toBe(true);
    for (const bad of c.unacceptable ?? []) {
      expect(top3, `${c.id}: ${bad} is unacceptable and made the top three`).not.toContain(bad);
    }
  });
});
