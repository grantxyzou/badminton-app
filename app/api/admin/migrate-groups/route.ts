/**
 * The Phase 2 backfill (`lib/groupBackfill.ts`), behind three locks.
 *
 *   GET  — status: is `groups/bpm` there, who has a membership, how many
 *          rows in each group container still carry no `groupId`. Admin
 *          cookie only; read-only, and the number the Phase 5 flip is gated
 *          on ("zero unstamped for a week").
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
 * flag on → a week without `[group-leak]` → `TOLERATE_UNSTAMPED = false`.
 * Idempotent: a second run reports `exists` / `existing` / zero stamped, so
 * "run until the status is all zeros" is the whole operating procedure — and
 * with the limit that is literal, not aspirational: keep POSTing while
 * `remaining` is non-empty, then read GET until every count is zero.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { backfillStatus, runBackfill, DEFAULT_SCAN_CAP } from '@/lib/groupBackfill';

export const dynamic = 'force-dynamic';

const KEY_HEADER = 'x-migration-key';

/** Hash both sides first so a length difference cannot leak through timing (security rule 11). */
function keyMatches(provided: string | null): boolean {
  const expected = process.env.MIGRATION_KEY;
  if (!expected || expected.length < 16 || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    return NextResponse.json(await backfillStatus());
  } catch (error) {
    console.error('GET /api/admin/migrate-groups:', error);
    return NextResponse.json({ error: 'status_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Rate limit before auth (rule 4): a key guess must cost the guesser.
  const ip = getClientIp(req);
  if (!checkRateLimit(`migrate-groups:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  if (!process.env.MIGRATION_KEY) {
    return NextResponse.json({ error: 'migration_key_not_configured' }, { status: 503 });
  }
  if (!keyMatches(req.headers.get(KEY_HEADER))) return unauthorized();

  let dryRun = true;
  let limit = DEFAULT_SCAN_CAP;
  try {
    const body = await req.json();
    dryRun = body?.dryRun !== false;
    // A caller may go smaller (a cautious first pass) or larger (a container
    // that is nearly done), within a ceiling the request can actually finish.
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(10000, Math.floor(body.limit)));
    }
  } catch {
    // no body — a dry run, the safe default
  }

  try {
    const summary = await runBackfill({ dryRun, limit });
    return NextResponse.json(summary);
  } catch (error) {
    console.error('POST /api/admin/migrate-groups:', error);
    return NextResponse.json({ error: 'migration_failed' }, { status: 500 });
  }
}
