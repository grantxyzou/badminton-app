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
 * Add --score to also print the engine's current top three for each member
 * (what you are rating against). Exit 2 on auth or request failure.
 */
const baseUrl = process.env.BASE_URL?.trim();
const adminCookie = process.env.ADMIN_COOKIE?.replace(/\s+/g, '');
const score = process.argv.includes('--score');
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
if (score) {
  for (const c of skeleton.cases) {
    // The skeleton carries no memberId on purpose; --score re-asks per case by
    // re-posting nothing — it uses the same order the server enumerated.
    c._currentTop3 = '(run with a memberId: GET /api/admin/fit-preview?memberId=<id>)';
  }
}
console.log(JSON.stringify(skeleton, null, 2));
