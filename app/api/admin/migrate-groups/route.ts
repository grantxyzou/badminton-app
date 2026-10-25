/**
 * The Phase 2 backfill (`lib/groupBackfill.ts`), behind three locks.
 *
 *   GET  — status: is `groups/bpm` there, who has a membership, how many
 *          rows in each group container still carry no `groupId`, and
 *          `leaks` — every row `groupScope()` caught crossing between clubs
 *          (`lib/groupLeaks.ts`). Read-only.
 *
 * BOTH ARE OPERATOR-ONLY (2026-10-24): an admin of the operator's club, BPM.
 * With groups on, `isAdminAuthedWithMember` admits the admin of ANY club, and
 * this status is deployment-wide — every club's member counts and every
 * leak, which names two clubs at once. Another club's admin gets a 403, the
 * same rule as `GET /api/reports/feedback`.
 *   POST — `{ dryRun: true }` counts what a run would do and writes nothing;
 *          `{ dryRun: false }` does it. Admin cookie AND `x-migration-key`
 *          equal to `MIGRATION_KEY` (App Settings), compared in constant time.
 *          An unset key is a 503, not an open door: the route exists in every
 *          deployment, the key only in the one that has decided to migrate.
 *          Optional `{ limit }` caps the rows stamped PER CONTAINER, because
 *          one request has 230s before Azure App Service ends it and `events`
 *          has no ceiling; the summary's `remaining` names what is left.
 *
 * Prod order (the spec): deploy flag-off → GET → dry run → run → GET zeros →
 * flag on → a second club runs one session end to end → `leaks` reads zero →
 * `TOLERATE_UNSTAMPED = false`. (Until 2026-10-24 the gate was "a week of the
 * log stream without `[group-leak]`", which needed a person watching logs for
 * a week and proved little while BPM was the only club.)
 * Idempotent: a second run reports `exists` / `existing` / zero stamped, so
 * "run until the status is all zeros" is the whole operating procedure — and
 * with the limit that is literal, not aspirational: keep POSTing while
 * `remaining` is non-empty, then read GET until every count is zero.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { MIGRATION_KEY_HEADER, migrationKeyConfigured, migrationKeyMatches } from '@/lib/migrationKey';
import { backfillStatus, runBackfill, DEFAULT_SCAN_CAP, DEFAULT_ROW_BUDGET } from '@/lib/groupBackfill';
import { readGroupLeaks } from '@/lib/groupLeaks';
import { BPM_GROUP_ID } from '@/lib/groupScope';

export const dynamic = 'force-dynamic';

/** The operator's club is the one whose admin may read and run this. */
const operatorOnly = () => NextResponse.json({ error: 'operator_only' }, { status: 403 });

export async function GET(req: NextRequest) {
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  if (auth.groupId !== BPM_GROUP_ID) return operatorOnly();
  let status: Awaited<ReturnType<typeof backfillStatus>>;
  try {
    status = await backfillStatus();
  } catch (error) {
    console.error('GET /api/admin/migrate-groups:', error);
    return NextResponse.json({ error: 'status_failed' }, { status: 500 });
  }
  // A failed leak read is said, never shown as zero: "no leaks" is the answer
  // the strict-mode switch waits for, so a lying zero would flip it.
  let leaks: Awaited<ReturnType<typeof readGroupLeaks>> | { error: 'read_failed' };
  try {
    leaks = await readGroupLeaks();
  } catch (error) {
    console.error('GET /api/admin/migrate-groups leaks:', error);
    leaks = { error: 'read_failed' };
  }
  return NextResponse.json({ ...status, leaks });
}

export async function POST(req: NextRequest) {
  // Rate limit before auth (rule 4): a key guess must cost the guesser.
  const ip = getClientIp(req);
  if (!checkRateLimit(`migrate-groups:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();
  if (auth.groupId !== BPM_GROUP_ID) return operatorOnly();
  if (!migrationKeyConfigured()) {
    return NextResponse.json({ error: 'migration_key_not_configured' }, { status: 503 });
  }
  if (!migrationKeyMatches(req.headers.get(MIGRATION_KEY_HEADER))) return unauthorized();

  let dryRun = true;
  let limit = DEFAULT_SCAN_CAP;
  let budget = DEFAULT_ROW_BUDGET;
  try {
    const body = await req.json();
    dryRun = body?.dryRun !== false;
    // A caller may go smaller (a cautious first pass) or larger (a container
    // that is nearly done), within a ceiling the request can actually finish.
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(10000, Math.floor(body.limit)));
    }
    // `budget` is the one that bounds the REQUEST — `limit` is per container,
    // and 13 containers at the old ceiling was 130,000 rows in a 230s window.
    // Raising it is allowed; defeating it is not.
    if (typeof body?.budget === 'number' && Number.isFinite(body.budget)) {
      budget = Math.max(1, Math.min(20000, Math.floor(body.budget)));
    }
  } catch {
    // no body — a dry run, the safe default
  }

  try {
    const summary = await runBackfill({ dryRun, limit, budget });
    return NextResponse.json(summary);
  } catch (error) {
    console.error('POST /api/admin/migrate-groups:', error);
    return NextResponse.json({ error: 'migration_failed' }, { status: 500 });
  }
}
