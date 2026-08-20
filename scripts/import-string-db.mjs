#!/usr/bin/env node
/**
 * Author-time import: merges scripts/data/badminton_string_database.json into
 * scripts/data/equipment-catalog.json. Run once; the OUTPUT is committed.
 * Not part of the runtime path.
 *
 * This is the route reference data actually takes into Cosmos in this repo:
 * source JSON -> this importer -> equipment-catalog.json ->
 * ensureCatalogSeeded() on first handler call. It needs no credentials, and
 * every change is reviewable as a diff. (scripts/sync_cosmos_string_db.py
 * writes to Cosmos directly instead; it exists to mirror an external script
 * and is NOT what feeds the Gear register.)
 *
 * Union, never replace — same contract as import-racket-db-v2.mjs. No string
 * id collides with the 71 existing racket ids, so today this is purely
 * additive; the merge branch is there so a re-run after editing the source
 * updates attributes instead of duplicating rows.
 *
 * TWO THINGS TO KNOW ABOUT THE RATINGS
 * ------------------------------------
 * 1. repulsion / durability / control / hittingSound are MARKETING numbers on
 *    a nominal 1-10. Yonex publishes 3 axes, Victor 4, Li-Ning 5, each on its
 *    own curve — one Yonex string is literally rated 11 out of 10. They are
 *    reliable WITHIN a brand and directional ACROSS brands, so `ratingSource`
 *    is carried through unchanged: a consumer must be able to tell
 *    "Brand published" from "Consensus estimate" before ranking on them.
 *    gaugeMm is the only objective cross-brand spec. Do not surface these as
 *    if they were measurements.
 * 2. Nothing here is normalized or rescaled. Rescaling three incompatible
 *    curves onto one axis would manufacture a false comparability that reads
 *    as fact downstream. Any ranking logic weights gauge and category and uses
 *    the 1-10 scores as tie-breakers — see docs/superpowers/reference/
 *    pair_racket_string.py, which stays the source of truth for that model.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, 'data', 'badminton_string_database.json');
const TARGET = join(here, 'data', 'equipment-catalog.json');

/**
 * skillLevel -> ACE stage range [1-6], the same scale TIER_RANGE uses for
 * rackets. Bands overlap deliberately: a string is not off-limits the moment
 * a player crosses a boundary, and a hard cut would make the recommender
 * lurch between check-ins.
 */
const SKILL_RANGE = {
  Beginner: [1, 3],
  Intermediate: [2, 5],
  Advanced: [4, 6],
};

// Copied by hand from import-racket-db-v2.mjs — NOT shared. If either file
// changes this constant, the other MUST be updated manually or the catalog
// ends up with two exchange rates in it.
const USD_TO_CAD = 1.38;

function mapRecord(raw) {
  const attributes = {};
  const put = (key, value) => {
    if (value !== undefined && value !== null && value !== '') attributes[key] = value;
  };

  put('series', raw.series);
  // `stringType` and not `category`: the top-level `category` is the catalog's
  // partition key and is always the literal 'string'. Mirrors how the racket
  // importer renames its source `category` to `playStyle`.
  put('stringType', raw.category);
  put('brandCategory', raw.brandCategory);
  put('gaugeMm', raw.gaugeMm);
  put('gaugeCrossMm', raw.gaugeCrossMm); // only present on Hybrid construction
  put('gaugeClass', raw.gaugeClass);
  put('construction', raw.construction);
  put('feel', raw.feel);
  put('feelScale', raw.feelScale);
  put('coreMaterial', raw.coreMaterial);
  put('outerMaterial', raw.outerMaterial);
  put('technology', raw.technology);
  put('repulsion', raw.repulsion);
  put('durability', raw.durability);
  put('control', raw.control);
  put('hittingSound', raw.hittingSound);
  put('ratingSource', raw.ratingSource);
  put('tensionMinLbs', raw.tensionMinLbs);
  put('tensionMaxLbs', raw.tensionMaxLbs);
  put('skillLevel', raw.skillLevel);
  put('bestFor', raw.bestFor);
  put('setLengthM', raw.setLengthM);
  put('reelLengthM', raw.reelLengthM);
  put('colors', raw.colors);
  put('priceSetUsdMin', raw.priceSetUsdMin);
  put('priceSetUsdMax', raw.priceSetUsdMax);
  put('releaseYear', raw.releaseYear);
  put('notableUsers', raw.notableUsers);
  put('lastVerified', raw.lastVerified);

  const item = {
    // Lowercased: catalog ids are required to match /^[a-z0-9-]+$/ (see
    // __tests__/equipment-catalog-seed.test.ts). Racket source ids are already
    // lowercase so the racket importer never had to do this; string source ids
    // are not ("YX-BG65"). Deterministic either way, so re-runs stay stable.
    id: `string-${String(raw.id).toLowerCase()}`,
    category: 'string', // partition key — always this literal
    brand: raw.brand,
    model: raw.model,
    skillRange: SKILL_RANGE[raw.skillLevel] ?? [1, 6],
    attributes,
    seeded: true,
  };
  // Set price, min of the published range — the same end of the range the
  // racket importer takes, so the two do not disagree about what msrp means.
  if (typeof raw.priceSetUsdMin === 'number') {
    item.msrp = Math.round(raw.priceSetUsdMin * USD_TO_CAD);
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
  if (byId.has(mapped.id)) {
    merged += 1;
    const existing = byId.get(mapped.id);
    // Attribute-by-attribute: source keys win on collision, but any existing
    // key the source does not supply is preserved rather than dropped.
    existing.attributes = { ...existing.attributes, ...mapped.attributes };
    existing.skillRange = mapped.skillRange;
    // Never clobber a hand-set msrp.
    if (mapped.msrp !== undefined && existing.msrp === undefined) {
      existing.msrp = mapped.msrp;
    }
  } else {
    added += 1;
    byId.set(mapped.id, mapped);
  }
}

target.items = [...byId.values()];

// The _meta purpose said "50 rackets only — strings / shoes / shuttles ...
// arrive in the Equipment track". Strings have now arrived, so leaving it
// would make the file describe a state it is no longer in.
const counts = target.items.reduce((acc, i) => {
  acc[i.category] = (acc[i.category] ?? 0) + 1;
  return acc;
}, {});
const summary = Object.entries(counts)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([cat, n]) => `${n} ${cat}${n === 1 ? '' : 's'}`)
  .join(', ');
target._meta.purpose =
  `Seed data for the equipment catalog: ${summary}. ` +
  'Shoes / shuttles / bags / grips are not sourced yet — the Gear register ' +
  'parks a category until the catalog can answer for it, so adding rows here ' +
  'is the only step needed to un-park one.';

writeFileSync(TARGET, `${JSON.stringify(target, null, 2)}\n`);
console.log(`merged ${merged}, added ${added}, total ${target.items.length} (${summary})`);
