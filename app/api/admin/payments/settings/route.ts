/**
 * PATCH /api/admin/payments/settings — `{ holdAfterUnpaid }`: switch the
 * unpaid soft hold on (2, usually) or off (0). Off by default; the admin card
 * shows who it would hold before offering the switch (docs/plans/payments.md).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { setHoldThreshold } from '@/lib/paymentsInbox';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`admin-payments-settings:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const n = body.holdAfterUnpaid;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 10) {
    return NextResponse.json({ error: 'invalid_hold' }, { status: 400 });
  }
  try {
    await setHoldThreshold(resolveGroupId(req), n);
    return NextResponse.json({ holdAfterUnpaid: n });
  } catch (err) {
    console.error('PATCH /api/admin/payments/settings failed', err);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}
