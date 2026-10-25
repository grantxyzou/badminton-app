/**
 * GET /api/admin/payments — the e-transfer inbox: what is waiting for a person,
 * what matched recently, and whether the club's script is alive. `?count=1`
 * answers only `{ configured, waiting }`, for the Command Center's menu row.
 *
 * The ASYNC admin check even though this is a read: it returns the legal names
 * on bank transfers (security rule 10's "sensitive payment data"), so a
 * demoted admin's still-valid cookie must stop working at once.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { inboxCount, inboxSummary } from '@/lib/paymentsInbox';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`admin-payments:${getClientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    // `?count=1` is the Command Center's menu row: two numbers, no roster read.
    const groupId = resolveGroupId(req);
    if (req.nextUrl.searchParams.get('count') === '1') return NextResponse.json(await inboxCount(groupId));
    return NextResponse.json(await inboxSummary(groupId));
  } catch (err) {
    console.error('GET /api/admin/payments failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}
