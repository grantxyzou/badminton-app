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
