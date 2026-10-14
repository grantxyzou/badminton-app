/**
 * The container fold (`lib/containerFold.ts`, `docs/plans/container-fold.md`),
 * behind the same three locks as `migrate-groups`:
 *
 *   GET  — status: per move, how many rows of the old container have no copy
 *          in the new home yet, and how many changelog rows carry no `kind`.
 *          Admin cookie only; read-only; the number PR 2 is gated on.
 *   POST — `{ dryRun: true }` counts what a run would copy and writes nothing;
 *          `{ dryRun: false }` copies. Admin cookie AND `x-migration-key`.
 *
 * Prod order: deploy → GET → dry run → run → GET reads zero → PR 2 (delete
 * the union reads and this route) → delete the old containers in the portal.
 * Idempotent: a copied row keeps its id, so a second run reports `existing`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { MIGRATION_KEY_HEADER, migrationKeyConfigured, migrationKeyMatches } from '@/lib/migrationKey';
import { foldStatus, runFold } from '@/lib/containerFold';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    return NextResponse.json(await foldStatus());
  } catch (error) {
    console.error('GET /api/admin/migrate-containers:', error);
    return NextResponse.json({ error: 'status_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Rate limit before auth (rule 4): a key guess must cost the guesser.
  if (!checkRateLimit(`migrate-containers:${getClientIp(req)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  if (!migrationKeyConfigured()) {
    return NextResponse.json({ error: 'migration_key_not_configured' }, { status: 503 });
  }
  if (!migrationKeyMatches(req.headers.get(MIGRATION_KEY_HEADER))) return unauthorized();

  let dryRun = true;
  try {
    const body = await req.json();
    dryRun = body?.dryRun !== false;
  } catch {
    // no body — a dry run, the safe default
  }

  try {
    return NextResponse.json(await runFold({ dryRun }));
  } catch (error) {
    console.error('POST /api/admin/migrate-containers:', error);
    return NextResponse.json({ error: 'migration_failed' }, { status: 500 });
  }
}
