/**
 * Store credit, admin side (docs/plans/payments.md).
 *   GET  ?memberId=  — a member's balance and history in this club.
 *   POST { memberId, amountCents, note } — give credit (negative takes it back,
 *        never below zero). Async admin check on both: it is money.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { groupScope } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { balanceOf, CreditError, grantCredit, creditLedgerFor } from '@/lib/storeCredit';
import { isSentinelLedgerId } from '@/lib/ledgerMirror';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-credit:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  const memberId = req.nextUrl.searchParams.get('memberId') ?? '';
  if (!memberId) return NextResponse.json({ error: 'memberId_required' }, { status: 400 });
  try {
    const entries = await creditLedgerFor(groupScope(resolveGroupId(req)), memberId);
    return NextResponse.json({ balanceCents: balanceOf(entries), entries: entries.slice(0, 50) });
  } catch (err) {
    console.error('GET /api/admin/credit failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) return off();
  if (!checkRateLimit(`admin-credit-grant:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  // `~club` and friends are the ledger's own partitions, never a person to credit.
  if (!memberId || isSentinelLedgerId(memberId) || typeof body.amountCents !== 'number') return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  try {
    const entry = await grantCredit(resolveGroupId(req), {
      memberId,
      amountCents: body.amountCents,
      note: typeof body.note === 'string' ? body.note : '',
      adminId: admin.memberId,
    });
    return NextResponse.json(entry);
  } catch (err) {
    if (err instanceof CreditError) return NextResponse.json({ error: err.code }, { status: 400 });
    console.error('POST /api/admin/credit failed', err);
    return NextResponse.json({ error: 'grant_failed' }, { status: 500 });
  }
}
