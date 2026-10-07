/**
 * The ledger backfill (`lib/ledgerBackfill.ts`), behind the same three locks
 * as the group backfill:
 *
 *   GET  — status: how many settled sessions, billable jobs and purchases
 *          still have no ledger entry. Admin cookie; read-only.
 *   POST — `{ dryRun: true }` counts what a run would write; `{ dryRun: false }`
 *          writes it. Admin cookie AND `x-migration-key` equal to
 *          `MIGRATION_KEY`, in constant time; unset → 503, never an open door.
 *          Optional `limit` (rows per unit), `budget` (total), `after`
 *          (cursor per unit, from a previous summary's `remaining`).
 *
 * Procedure: dry run → run → re-run with `after` until `remaining` is `{}` →
 * GET shows zeros. Deterministic ids make a repeat a no-op.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { keyMatchesHash, sha256Hex } from '@/lib/clubKey';
import { runLedgerBackfill, ledgerBackfillStatus, BACKFILL_UNITS, type BackfillUnit } from '@/lib/ledgerBackfill';

export const dynamic = 'force-dynamic';

const KEY_HEADER = 'x-migration-key';

/** Hash both sides first so a length difference cannot leak through timing (security rule 11). */
function keyMatches(provided: string | null): boolean {
  const expected = process.env.MIGRATION_KEY;
  if (!expected || expected.length < 16 || !provided) return false;
  return keyMatchesHash(provided, sha256Hex(expected));
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    return NextResponse.json(await ledgerBackfillStatus(resolveGroupId(req)));
  } catch (error) {
    console.error('GET /api/admin/ledger-backfill:', error);
    return NextResponse.json({ error: 'status_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Rate limit before auth (rule 4): a key guess must cost the guesser.
  if (!checkRateLimit(`ledger-backfill:${getClientIp(req)}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  if (!process.env.MIGRATION_KEY) {
    return NextResponse.json({ error: 'migration_key_not_configured' }, { status: 503 });
  }
  if (!keyMatches(req.headers.get(KEY_HEADER))) return unauthorized();

  let dryRun = true;
  let limit: number | undefined;
  let budget: number | undefined;
  const after: Partial<Record<BackfillUnit, string>> = {};
  try {
    const body = await req.json();
    dryRun = body?.dryRun !== false;
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) limit = body.limit;
    if (typeof body?.budget === 'number' && Number.isFinite(body.budget)) budget = body.budget;
    if (body?.after && typeof body.after === 'object') {
      for (const u of BACKFILL_UNITS) {
        const v = (body.after as Record<string, unknown>)[u];
        if (typeof v === 'string') after[u] = v;
      }
    }
  } catch {
    // no body — a dry run, the safe default
  }

  try {
    return NextResponse.json(await runLedgerBackfill(resolveGroupId(req), { dryRun, limit, budget, after }));
  } catch (error) {
    console.error('POST /api/admin/ledger-backfill:', error);
    return NextResponse.json({ error: 'backfill_failed' }, { status: 500 });
  }
}
