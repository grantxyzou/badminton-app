import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * SWEEP COVERAGE — every route that acts inside a group must be driven by a
 * two-club test (multi-group Phase 5, backlog #529).
 *
 * The isolation tests (`__tests__/group-*.test.ts`) prove one club cannot see
 * another's rows, route by route. They only prove it for the routes they
 * import. A new route that reads a group container and is never driven by one
 * of them is exactly where a leak would hide, and nothing used to say so.
 *
 * A route ACTS INSIDE A GROUP when it calls `groupScope(` or `resolveGroupId(`.
 * That is deliberately broad: a route can reach a group container through a
 * lib helper that takes the group (`readShopOpen(groupId)`), so `groupScope(`
 * alone would miss it. A route is SWEPT when any `__tests__/group-*.test.ts`
 * file imports it.
 *
 * `UNSWEPT` is a RATCHET, not an exemption list: it names the routes that
 * existed before this canary and have no two-club test yet. It may only
 * shrink. The build fails when
 *   - a group route is neither swept nor listed (a NEW gap), or
 *   - a listed route is now swept, or no longer acts inside a group, or is
 *     gone (a STALE entry — delete the line).
 * When it is empty, delete it and the second assertion with it: an empty
 * backlog leaves half the test unable to fail (CLAUDE.md, the 1b ratchet).
 */
const root = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts') out.push(path.relative(root, p).split(path.sep).join('/'));
  }
  return out;
}

const GROUP_CALL = /\b(groupScope|resolveGroupId)\(/;

const groupRoutes = walk(path.join(root, 'app/api'))
  .filter((f) => GROUP_CALL.test(readFileSync(path.join(root, f), 'utf8')))
  .sort();

const IMPORT = /from '@\/(app\/api\/[^']+\/route)'/g;
const swept = new Set<string>();
for (const name of readdirSync(path.join(root, '__tests__'))) {
  if (!/^group-.*\.test\.tsx?$/.test(name)) continue;
  const src = readFileSync(path.join(root, '__tests__', name), 'utf8');
  for (const m of src.matchAll(IMPORT)) swept.add(`${m[1]}.ts`);
}

const UNSWEPT: readonly string[] = [
  'app/api/admin/backfill-attendance/route.ts',
  'app/api/admin/catalog-gaps/route.ts',
  'app/api/admin/credit/route.ts',
  'app/api/admin/expenses/route.ts',
  'app/api/admin/giftcards/route.ts',
  'app/api/admin/ledger-backfill/route.ts',
  'app/api/admin/ledger/reconcile/route.ts',
  'app/api/admin/ledger/route.ts',
  'app/api/admin/metrics/route.ts',
  'app/api/admin/migrate-memberId/route.ts',
  'app/api/admin/payments/assign/route.ts',
  'app/api/admin/payments/key/route.ts',
  'app/api/admin/payments/route.ts',
  'app/api/admin/payments/settings/route.ts',
  'app/api/admin/reports/key/route.ts',
  'app/api/assessments/route.ts',
  'app/api/auth/apple/start/route.ts',
  'app/api/auth/claim-name/route.ts',
  'app/api/auth/google/start/route.ts',
  'app/api/auth/handoff/claim/route.ts',
  'app/api/auth/migrate/claim/route.ts',
  'app/api/auth/migrate/start/route.ts',
  'app/api/auth/reset-password/route.ts',
  'app/api/auth/signin/route.ts',
  'app/api/birds/reconcile/route.ts',
  'app/api/credit/redeem/route.ts',
  'app/api/credit/route.ts',
  'app/api/credit/spend/route.ts',
  'app/api/equipment/fit-verdict/route.ts',
  'app/api/equipment/gear/route.ts',
  'app/api/equipment/share-card/route.ts',
  'app/api/events/route.ts',
  'app/api/groups/current/route.ts',
  'app/api/groups/switch/route.ts',
  'app/api/kudos/eligible/route.ts',
  'app/api/members/[id]/history/route.ts',
  'app/api/members/access-request/claim/route.ts',
  'app/api/members/access-request/route.ts',
  'app/api/payments/self-report/route.ts',
  'app/api/players/reset-access/route.ts',
  'app/api/players/unpaid/route.ts',
  'app/api/recommend/route.ts',
  'app/api/session/advance/route.ts',
  'app/api/session/bird-usage/route.ts',
  'app/api/session/dismiss-anomaly/route.ts',
  'app/api/session/settle/route.ts',
  'app/api/sessions/costs/route.ts',
  'app/api/sessions/history/route.ts',
  'app/api/sessions/locations/route.ts',
  'app/api/sessions/recent/route.ts',
  'app/api/sessions/route.ts',
  'app/api/skills/route.ts',
  'app/api/stats/attendance/route.ts',
  'app/api/stats/club/tension/route.ts',
  'app/api/stats/drills/done/route.ts',
  'app/api/stats/drills/route.ts',
  'app/api/stats/insight/route.ts',
  'app/api/stats/level/route.ts',
  'app/api/stats/partners/route.ts',
  'app/api/stringing/jobs/[id]/accept/route.ts',
  'app/api/stringing/jobs/[id]/route.ts',
  'app/api/stringing/requests/route.ts',
];

describe('sweep coverage: every group route has a two-club test', () => {
  it('finds group routes and swept routes at all (the scan is not vacuous)', () => {
    expect(groupRoutes.length).toBeGreaterThan(40);
    expect(swept.size).toBeGreaterThan(10);
    expect(groupRoutes).toContain('app/api/session/route.ts');
    expect(swept.has('app/api/session/route.ts')).toBe(true);
  });

  it('no group route is missing from both the sweep and the backlog', () => {
    const listed = new Set(UNSWEPT);
    const gaps = groupRoutes.filter((f) => !swept.has(f) && !listed.has(f));
    expect(
      gaps,
      'Drive these routes from a __tests__/group-*.test.ts file with two clubs (see group-isolation-routes.test.ts for the pattern).',
    ).toEqual([]);
  });

  it('the backlog holds no stale entries — it only shrinks', () => {
    const live = new Set(groupRoutes);
    const stale = UNSWEPT.filter((f) => swept.has(f) || !live.has(f));
    expect(stale, 'Delete these lines from UNSWEPT: they are swept now, or no longer act inside a group.').toEqual([]);
  });
});
