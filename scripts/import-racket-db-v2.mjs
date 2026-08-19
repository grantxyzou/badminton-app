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
 * weightGrams). Constants TIER_RANGE and USD_TO_CAD are copied from the v1
 * importer by hand — they are NOT automatically shared. If either file changes
 * its constants, the other MUST be updated manually to prevent pricing drift.
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
  if (byId.has(mapped.id)) {
    merged += 1;
    // Field-level merge: v2 attributes win, but preserve curated fields from existing.
    const existing = byId.get(mapped.id);
    // v2 wins on normalized attributes and skill tier mapping
    existing.attributes = mapped.attributes;
    existing.skillRange = mapped.skillRange;
    // Preserve curated fields: sources array and hand-set msrp (only set USD-derived msrp if none exists)
    if (mapped.msrp !== undefined && existing.msrp === undefined) {
      existing.msrp = mapped.msrp;
    }
    // Preserve other top-level fields from existing (sources, retailer links, etc.)
  } else {
    added += 1;
    // New id: insert the mapped record as-is
    byId.set(mapped.id, mapped);
  }
}

target.items = [...byId.values()];
writeFileSync(TARGET, `${JSON.stringify(target, null, 2)}\n`);
console.log(`merged ${merged}, added ${added}, total ${target.items.length}`);
