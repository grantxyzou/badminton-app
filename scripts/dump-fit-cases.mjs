#!/usr/bin/env node
/**
 * Print golden-set case skeletons for the racket fit engine, for the owner
 * and the club stringer to rate by hand.
 *
 * READ-ONLY: one admin GET against `/api/admin/fit-preview`, which returns one
 * anonymised skeleton (ids gNN, no names) per member who has a gear doc or a
 * check-in, with `acceptable: []` to fill. Paste the result into
 * `__tests__/fixtures/fit-golden.json` and set `ratedBy` / `ratedAt` honestly.
 *
 * Usage:
 *   ADMIN_COOKIE='<admin_session value>' BASE_URL='https://bpm.grantzou.com/bpm' node scripts/dump-fit-cases.mjs
 *   ADMIN_COOKIE='<from devtools>'        BASE_URL='http://localhost:3000/bpm'   node scripts/dump-fit-cases.mjs
 *
 * To see what the engine currently says for one member (what you are rating
 * against), ask the same endpoint with `?memberId=<id>`. Exit 2 on auth or
 * request failure.
 */
const baseUrl = process.env.BASE_URL?.trim();
const adminCookie = process.env.ADMIN_COOKIE?.replace(/\s+/g, '');
if (!baseUrl || !adminCookie) {
  console.error('BASE_URL and ADMIN_COOKIE env vars are required (see the header of this file).');
  process.exit(2);
}
const headers = { cookie: `admin_session=${adminCookie}` };
const res = await fetch(`${baseUrl}/api/admin/fit-preview`, { headers });
if (!res.ok) {
  console.error(`fit-preview responded ${res.status}: ${await res.text()}`);
  process.exit(2);
}
const skeleton = await res.json();
// The cases go to stdout WITHOUT member ids — that is what gets pasted into
// the fixture. The case→memberId key goes to stderr, for the operator only:
// it is how you ask `GET /api/admin/fit-preview?memberId=<id>` for the
// engine's current top three while rating.
const key = skeleton.cases.map((c) => `${c.id}\t${c.memberId ?? ''}`).join('\n');
for (const c of skeleton.cases) delete c.memberId;
console.log(JSON.stringify(skeleton, null, 2));
console.error(`\n# operator key (NOT for the fixture)\n${key}\n`);
