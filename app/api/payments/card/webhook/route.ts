/**
 * POST /api/payments/card/webhook — Stripe's Connect webhook for card
 * payments (SANDBOX PROTOTYPE, docs/plans/card-pay-prototype.md).
 *
 * The signature IS the auth: nothing is read before `constructEventAsync`
 * has verified the raw body against STRIPE_WEBHOOK_SECRET (rules 3 and 4 —
 * the rate limit runs first). Stripe calls server-to-server with no Origin
 * header, so the proxy's cross-site guard lets it through unexempted.
 *
 * Register it in Stripe as a CONNECT endpoint ("events on connected
 * accounts"): a direct charge's events happen on the club's account, and
 * `event.account` is what proves which club the money is for.
 *
 * A non-2xx makes Stripe retry, so only a failure worth retrying answers 500;
 * everything the handler decides to ignore is a 200.
 */
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { applyPaidCheckout, cardPayOn, stripeClient } from '@/lib/cardPay';

export const dynamic = 'force-dynamic';

const HANDLED: readonly string[] = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];

export async function POST(req: NextRequest) {
  if (!cardPayOn()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`card-webhook:${getClientIp(req)}`, 300, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripe || !secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const signature = req.headers.get('stripe-signature');
  if (!signature) return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch {
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  }

  if (!HANDLED.includes(event.type)) return NextResponse.json({ received: true });
  try {
    const result = await applyPaidCheckout(event.data.object as Stripe.Checkout.Session, event.account);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    console.error('[card-pay] webhook failed; Stripe will retry', { event: event.id, err });
    return NextResponse.json({ error: 'apply_failed' }, { status: 500 });
  }
}
