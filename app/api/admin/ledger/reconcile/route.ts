/**
 * The ledger reconcile (`lib/ledgerReconcile.ts`), for the admin:
 *
 *   GET  — the last stored check, with each mismatch's row named by the
 *          roster (the settings doc holds ids only). `lastAt: null` = never.
 *   POST — "Check now": runs it, stores it, returns the same shape.
 *
 * The ASYNC admin check even on the read: it names who owes what.
 * Both 404 with the mirror off — there is nothing to check against.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { getMirrorFailures } from '@/lib/ledgerMirror';
import { lastReconcile, reconcileAndRecord, type Mismatch, type ReconcileResult } from '@/lib/ledgerReconcile';
import { rosterMembers } from '@/lib/roster';

export const dynamic = 'force-dynamic';

async function withNames(groupId: string, r: Omit<ReconcileResult, 'mirrorFailures'>) {
  const names = new Map<string, string>();
  for (const { member } of await rosterMembers(groupId, { includeInactive: true })) names.set(member.id, member.name);
  return {
    lastAt: r.at,
    checked: r.checked,
    unlisted: r.unlisted,
    truncated: r.truncated,
    mirrorFailures: getMirrorFailures(),
    mismatches: r.mismatches.map((m: Mismatch) => ({ ...m, name: names.get(m.memberId) ?? null })),
  };
}

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`ledger-reconcile-read:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const groupId = resolveGroupId(req);
    const last = await lastReconcile(groupId);
    if (!last) return NextResponse.json({ lastAt: null, mirrorFailures: getMirrorFailures() });
    return NextResponse.json(await withNames(groupId, last));
  } catch (error) {
    console.error('GET /api/admin/ledger/reconcile:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // A whole-roster read on every tap; ten in a quarter hour is a person, not a loop.
  if (!checkRateLimit(`ledger-reconcile:${getClientIp(req)}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const groupId = resolveGroupId(req);
    return NextResponse.json(await withNames(groupId, await reconcileAndRecord(groupId)));
  } catch (error) {
    console.error('POST /api/admin/ledger/reconcile:', error);
    return NextResponse.json({ error: 'reconcile_failed' }, { status: 503 });
  }
}
