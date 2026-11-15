/**
 * The club's card payments (SANDBOX PROTOTYPE, docs/plans/card-pay-prototype.md).
 *
 *   GET  — is the club's Stripe account connected, and can it take cards yet?
 *          Asks Stripe, and remembers the answer for Home's "Pay by card".
 *   POST — connect the club's Stripe account (created on first use) and
 *          return a Stripe-hosted onboarding link to finish in.
 *
 * ORGANISER ONLY, both: where a club's money lands is the organiser's call,
 * like handing out credit codes. 404 while NEXT_PUBLIC_FLAG_CARD_PAY is off
 * or no STRIPE_SECRET_KEY is set.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { CardPayError, cardPayOn, connectClub, refreshCardPayStatus } from '@/lib/cardPay';

export const dynamic = 'force-dynamic';

const off = () => NextResponse.json({ error: 'not_found' }, { status: 404 });
const organiserOnly = () => NextResponse.json({ error: 'organiser_only' }, { status: 403 });

export async function GET(req: NextRequest) {
  if (!cardPayOn()) return off();
  if (!checkRateLimit(`admin-card-pay:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  if (!admin.organiser) return organiserOnly();
  try {
    return NextResponse.json(await refreshCardPayStatus(resolveGroupId(req)));
  } catch (err) {
    console.error('GET /api/admin/card-pay failed', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!cardPayOn()) return off();
  if (!checkRateLimit(`admin-card-pay-connect:${getClientIp(req)}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) return unauthorized();
  if (!admin.organiser) return organiserOnly();
  try {
    return NextResponse.json(await connectClub(resolveGroupId(req), admin.memberId));
  } catch (err) {
    if (err instanceof CardPayError) return NextResponse.json({ error: err.code }, { status: 503 });
    console.error('POST /api/admin/card-pay failed', err);
    return NextResponse.json({ error: 'connect_failed' }, { status: 502 });
  }
}
