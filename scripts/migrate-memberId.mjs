#!/usr/bin/env node
/**
 * Backfill memberId on every players record by hitting the admin migration
 * endpoint. Idempotent. Halts on collisions.
 *
 * Usage:
 *   ADMIN_COOKIE='<value>' BASE_URL='https://bpm-next.azurewebsites.net' node scripts/migrate-memberId.mjs --dry-run
 *   ADMIN_COOKIE='<value>' BASE_URL='https://bpm-stable.azurewebsites.net' node scripts/migrate-memberId.mjs
 *
 * For local dev:
 *   BASE_URL='http://localhost:3000/bpm' ADMIN_COOKIE='<from devtools>' node scripts/migrate-memberId.mjs --dry-run
 *
 * Exit codes:
 *   0 — success
 *   1 — collisions detected (manual review required)
 *   2 — request or auth failure
 */

const dryRun = process.argv.includes('--dry-run');
const baseUrl = process.env.BASE_URL;
const adminCookie = process.env.ADMIN_COOKIE;

if (!baseUrl) {
  console.error('BASE_URL env var required (e.g., https://bpm-next.azurewebsites.net or http://localhost:3000/bpm)');
  process.exit(2);
}
if (!adminCookie) {
  console.error('ADMIN_COOKIE env var required (paste the admin_session cookie value from devtools)');
  process.exit(2);
}

const url = `${baseUrl.replace(/\/$/, '')}/api/admin/migrate-memberId`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `admin_session=${adminCookie}`,
    },
    body: JSON.stringify({ dryRun }),
  });

  if (!res.ok) {
    console.error(`Request failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text);
    process.exit(2);
  }

  const summary = await res.json();
  console.log(JSON.stringify(summary, null, 2));

  if (Array.isArray(summary.collisions) && summary.collisions.length > 0) {
    console.error(`\nHALT: ${summary.collisions.length} collision(s) require manual review.`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error('Migration request failed:', err);
  process.exit(2);
}
