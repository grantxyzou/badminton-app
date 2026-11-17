/**
 * POST /api/payments/card/form — the in-app card form, when the club charges
 * a card fee on credit cards (docs/plans/card-surcharge.md, lib/cardSurcharge.ts).
 *
 *   { step: 'start' }                              → what the form needs to draw
 *   { step: 'quote', paymentMethodId }             → the fee for this card, on an intent
 *   { step: 'confirm', intentId, native? }         → charge it (or a card check to finish)
 *
 * Nothing is marked paid here. The rows change only when Stripe's signed
 * webhook says the money arrived (`payment_intent.succeeded`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { resolveGroupId } from '@/lib/groupContext';
import { requireOutboundOrigin } from '@/lib/appOrigin';
import { CardPayError, cardPayOn } from '@/lib/cardPay';
import { SurchargeError, confirmCardPayment, quoteCardPayment, startCardForm } from '@/lib/cardSurcharge';

export const dynamic = 'force-dynamic';

const PM = /^pm_[A-Za-z0-9_]{6,}$/;
const PI = /^pi_[A-Za-z0-9_]{6,}$/;

export async function POST(req: NextRequest) {
  if (!cardPayOn()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!checkRateLimit(`card-form:${getClientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const member = await requireGroupMember(req);
  if (!member) return unauthorized();
  const body = (await req.json().catch(() => null)) as { step?: unknown; paymentMethodId?: unknown; intentId?: unknown; native?: unknown } | null;
  const groupId = resolveGroupId(req);
  try {
    if (body?.step === 'start') return NextResponse.json(await startCardForm(groupId, member.memberId));
    if (body?.step === 'quote' && typeof body.paymentMethodId === 'string' && PM.test(body.paymentMethodId)) {
      return NextResponse.json(await quoteCardPayment(groupId, member.memberId, body.paymentMethodId));
    }
    if (body?.step === 'confirm' && typeof body.intentId === 'string' && PI.test(body.intentId)) {
      // A card check (3-D Secure) that leaves the page comes back here: the
      // store app's sheet to /pay/done, the website to Home.
      const base = `${requireOutboundOrigin()}/bpm`;
      const returnUrl = body.native === true ? `${base}/pay/done` : `${base}/?tab=home&card=paid`;
      return NextResponse.json(await confirmCardPayment(groupId, member.memberId, body.intentId, returnUrl));
    }
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  } catch (err) {
    if (err instanceof CardPayError || err instanceof SurchargeError) return NextResponse.json({ error: err.code }, { status: 409 });
    // A card Stripe declined while confirming: say so in its words' place.
    const code = (err as { code?: string; type?: string })?.type === 'StripeCardError' ? 'card_declined' : null;
    if (code) return NextResponse.json({ error: code }, { status: 402 });
    console.error('POST /api/payments/card/form failed', err);
    return NextResponse.json({ error: 'card_form_failed' }, { status: 502 });
  }
}
