#!/usr/bin/env node
/**
 * One-shot backfill: read a CSV of historical attendance and POST each row
 * to /api/admin/backfill-attendance. Designed for the v1.3 cut where the
 * playing group wants prior weeks reflected in the Stats heatmap.
 *
 * Usage:
 *   node scripts/backfill-attendance.mjs [csvPath]
 *
 * Defaults to scripts/data/attendance.csv. CSV format (header required):
 *
 *   date,names
 *   2026-02-19,Grant Bruce Chris David
 *   2026-02-26,Grant Chris David Ethan
 *   2026-03-05,Grant Bruce
 *
 * Notes:
 * - Names are SPACE-separated within the names column (commas reserved for
 *   CSV column separator). Multi-word names → use a hyphen or underscore,
 *   then post-edit if needed.
 * - Dates are YYYY-MM-DD (the script tags the session at 20:00 Pacific).
 * - The endpoint is idempotent — re-running the script is safe; existing
 *   records are skipped, missing ones are filled in.
 * - Requires the script runner to authenticate as admin first. Set
 *   ADMIN_COOKIE environment variable to the value of the `admin_session`
 *   cookie from your browser (sign in via Profile → Admin tools, then copy
 *   the cookie value from devtools → Application → Cookies).
 *
 * Target deployment: defaults to bpm-stable's URL. Override with
 *   API_BASE=http://localhost:3000/bpm node scripts/backfill-attendance.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const DEFAULT_CSV = join(ROOT, 'scripts', 'data', 'attendance.csv');
const API_BASE = process.env.API_BASE
  ?? 'https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm';
const ADMIN_COOKIE = process.env.ADMIN_COOKIE;

if (!ADMIN_COOKIE) {
  console.error('[backfill-attendance] ADMIN_COOKIE env var is required.');
  console.error('  1. Sign in as admin in your browser.');
  console.error('  2. DevTools → Application → Cookies → copy the `admin_session` value.');
  console.error('  3. Re-run with: ADMIN_COOKIE=<value> node scripts/backfill-attendance.mjs');
  process.exit(1);
}

const csvPath = process.argv[2] ?? DEFAULT_CSV;

let csv;
try {
  csv = readFileSync(csvPath, 'utf8');
} catch (err) {
  console.error(`[backfill-attendance] could not read ${csvPath}:`, err.message);
  process.exit(1);
}

const lines = csv.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
if (lines.length < 2) {
  console.error('[backfill-attendance] CSV must have a header row + at least one data row.');
  process.exit(1);
}

const header = lines[0].toLowerCase();
if (!/^date\s*,\s*names/.test(header)) {
  console.error('[backfill-attendance] CSV header must be: date,names');
  process.exit(1);
}

let totalSessions = 0;
let totalCreated = 0;
let totalSkipped = 0;

for (const line of lines.slice(1)) {
  const commaIdx = line.indexOf(',');
  if (commaIdx < 0) {
    console.warn(`  skip: malformed row → ${line}`);
    continue;
  }
  const date = line.slice(0, commaIdx).trim();
  const namesField = line.slice(commaIdx + 1).trim();
  const names = namesField.split(/\s+/).filter(Boolean);

  if (names.length === 0) {
    console.warn(`  skip: ${date} has no names`);
    continue;
  }

  const url = `${API_BASE}/api/admin/backfill-attendance`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `admin_session=${ADMIN_COOKIE}`,
      },
      body: JSON.stringify({ date, names }),
    });
  } catch (err) {
    console.error(`  ERR ${date}: fetch failed →`, err.message);
    continue;
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`  ERR ${date}: ${res.status} ${res.statusText} → ${text}`);
    continue;
  }

  const data = await res.json();
  const created = data.playerRecordsCreated ?? 0;
  const skipped = data.playerRecordsSkipped ?? 0;
  totalSessions += 1;
  totalCreated += created;
  totalSkipped += skipped;
  console.log(`  ✓ ${date} (${data.sessionId}) — created ${created}, skipped ${skipped} (${names.length} names)`);
}

console.log('');
console.log(`[backfill-attendance] done: ${totalSessions} sessions, ${totalCreated} player records created, ${totalSkipped} already existed`);
