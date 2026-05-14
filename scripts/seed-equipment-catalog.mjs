#!/usr/bin/env node
/**
 * One-shot seed: load scripts/data/equipment-catalog.json and POST each item
 * to /api/equipment/catalog (admin-only). Designed for the Value-Hub Slice-0
 * bootstrap — see /root/.claude/plans/system-reminder-you-re-running-in-fizzy-river.md.
 *
 * Idempotent: items have deterministic `id` fields, so re-running skips
 * existing rows and only inserts new ones. The endpoint MUST honour the
 * `id` field on POST (same pattern as `birds` and `aliases`).
 *
 * Status: the POST endpoint lands in a follow-up PR. Until it does, run
 * with `--dry-run` (default) to print the parsed catalog without making
 * network calls. Once the endpoint ships, pass `--commit` to do the inserts.
 *
 * Usage:
 *   node scripts/seed-equipment-catalog.mjs              # dry-run
 *   node scripts/seed-equipment-catalog.mjs --commit     # actually POST
 *
 * Env:
 *   API_BASE       defaults to bpm-next; override for dev/stable
 *   ADMIN_COOKIE   required for --commit (paste from devtools)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = join(ROOT, 'scripts', 'data', 'equipment-catalog.json');
const API_BASE = process.env.API_BASE
  ?? 'https://vnext-badminton-app-enhcave5djcvafe9.canadacentral-01.azurewebsites.net/bpm';

const commit = process.argv.includes('--commit');

let raw;
try {
  raw = readFileSync(CATALOG_PATH, 'utf8');
} catch (err) {
  console.error(`[seed-catalog] cannot read ${CATALOG_PATH}: ${err.message}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`[seed-catalog] invalid JSON in ${CATALOG_PATH}: ${err.message}`);
  process.exit(1);
}

const items = Array.isArray(parsed?.items) ? parsed.items : [];
if (items.length === 0) {
  console.error('[seed-catalog] no items found in catalog data file.');
  process.exit(1);
}

console.log(`[seed-catalog] parsed ${items.length} items from ${CATALOG_PATH}`);
const byCategory = items.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] ?? 0) + 1;
  return acc;
}, {});
for (const [cat, n] of Object.entries(byCategory)) {
  console.log(`  - ${cat}: ${n}`);
}

if (!commit) {
  console.log('[seed-catalog] dry-run (no network). Re-run with --commit to POST.');
  process.exit(0);
}

const cookie = process.env.ADMIN_COOKIE;
if (!cookie) {
  console.error('[seed-catalog] --commit requires ADMIN_COOKIE env var.');
  console.error('  Sign in as admin → DevTools → Application → Cookies → copy `admin_session`.');
  process.exit(1);
}

const endpoint = `${API_BASE.replace(/\/$/, '')}/api/equipment/catalog`;
let inserted = 0;
let skipped = 0;
let failed = 0;

for (const item of items) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `admin_session=${cookie}`,
      },
      body: JSON.stringify(item),
    });
    if (res.status === 201) {
      inserted += 1;
      process.stdout.write('+');
    } else if (res.status === 409) {
      skipped += 1;
      process.stdout.write('.');
    } else {
      failed += 1;
      process.stdout.write('!');
      let body = '';
      try { body = await res.text(); } catch { /* body read failed; status is enough */ }
      console.error(`\n[seed-catalog] ${item.id} → ${res.status}: ${body.slice(0, 200)}`);
    }
  } catch (err) {
    failed += 1;
    process.stdout.write('!');
    console.error(`\n[seed-catalog] ${item.id} → network error: ${err?.message ?? err}`);
  }
}

console.log(`\n[seed-catalog] done. inserted=${inserted} skipped=${skipped} failed=${failed}`);
process.exit(failed === 0 ? 0 : 1);
