/**
 * POST /api/admin/payments/key — mint (or rotate) the club's inbox key.
 *
 * The plaintext is in THIS response and nowhere else; the server keeps only
 * its hash. Rotating invalidates the old key at once, so a script still using
 * it starts getting 401s — which is the point when a key has leaked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { mintPaymentsKey } from '@/lib/paymentsInbox';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!checkRateLimit(`admin-payments-key:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();
  try {
    const key = await mintPaymentsKey(resolveGroupId(req));
    return NextResponse.json({ key }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('POST /api/admin/payments/key failed', err);
    return NextResponse.json({ error: 'mint_failed' }, { status: 500 });
  }
}
