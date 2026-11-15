/**
 * POST /api/payments/card/checkout — "Pay by card" (SANDBOX PROTOTYPE,
 * docs/plans/card-pay-prototype.md): a Stripe-hosted Checkout page for the
 * signed-in member's SETTLED session lines, charged directly on their club's
 * own Stripe account. Answers `{ url }` to send the browser to.
 *
 * Nothing is marked paid here. The rows change only when Stripe's signed
 * webhook says the money arrived (`/api/payments/card/webhook`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { CardPayError, cardPayOn, startCardCheckout } from '@/lib/cardPay';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!cardPayOn()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`card-checkout:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  try {
    const { url } = await startCardCheckout(resolveGroupId(req), member.memberId);
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof CardPayError) return NextResponse.json({ error: err.code }, { status: 409 });
    console.error('POST /api/payments/card/checkout failed', err);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 502 });
  }
}
