/**
 * POST /api/admin/ledger/repair { kind: 'stringing', id, memberId } — the
 * Ledger check's "Restore the charge" for a DELETED stringing job that kept
 * its payment and lost its charge (`lib/ledgerRepair.ts`).
 *
 * A person's tap, never automatic: the reconcile stays read-only. Admin of
 * the club the cookie names, re-checked on the request (a mutating route);
 * the club's own ledger only, through `groupScope`. 409 with the reason for
 * anything it will not do: the job still exists (any change to it heals it),
 * or there is nothing to restore (a second tap, or no lone payment).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { restoreDeletedJobCharge } from '@/lib/ledgerRepair';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR')) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`ledger-repair:${getClientIp(req)}`, 20, 15 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  const body = (await req.json().catch(() => null)) as { kind?: unknown; id?: unknown; memberId?: unknown } | null;
  if (body?.kind !== 'stringing' || typeof body.id !== 'string' || !body.id || typeof body.memberId !== 'string' || !body.memberId) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const { outcome, amountCents } = await restoreDeletedJobCharge(groupScope(resolveGroupId(req)), body.memberId, body.id);
    if (outcome === 'restored') return NextResponse.json({ outcome, amountCents });
    if (outcome === 'failed') return NextResponse.json({ error: 'repair_failed' }, { status: 503 });
    return NextResponse.json({ error: outcome }, { status: 409 });
  } catch (error) {
    console.error('POST /api/admin/ledger/repair:', error);
    return NextResponse.json({ error: 'repair_failed' }, { status: 503 });
  }
}
