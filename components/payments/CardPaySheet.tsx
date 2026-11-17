'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Stripe, StripeCardElement } from '@stripe/stripe-js';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { isNative } from '@/lib/native';
import { announceBalanceChanged } from '@/lib/balanceRefresh';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Start {
  publishableKey: string;
  stripeAccount: string;
  amountCents: number;
  currency: string;
  bps: number;
}

interface Quote {
  intentId: string;
  baseCents: number;
  feeCents: number;
  totalCents: number;
  bps: number;
  funding: string;
  brand: string | null;
  last4: string | null;
}

type Phase = 'loading' | 'card' | 'checking' | 'review' | 'paying' | 'done' | 'failed';

/** The codes the route answers that have a sentence of their own. */
const KNOWN = new Set(['surcharge_off', 'nothing_to_pay', 'card_declined', 'already_done', 'club_not_ready']);

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 10 === 0 ? 1 : 2)}%`;

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/api/payments/card/form`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !json) throw new Error((json as { error?: string } | null)?.error ?? 'failed');
  return json;
}

/**
 * Paying by card INSIDE the app, when the club charges a card fee on credit
 * cards (docs/plans/card-surcharge.md). Stripe's hosted page cannot tell a
 * credit card from a debit card before charging, so the fee needs this form:
 *
 *   1. The card goes into Stripe's own field (an iframe; the number never
 *      touches BPM) and becomes a PaymentMethod on the club's account.
 *   2. The server works out the fee for THAT card — credit only, at most the
 *      club's rate and 2.4% — and the sheet SHOWS it, with the total, before
 *      anything is charged. Debit shows "no card fee".
 *   3. Pay charges exactly what was shown; a card check (3-D Secure) opens in
 *      Stripe's own window. The lines turn paid when Stripe's webhook lands.
 */
export default function CardPaySheet({ open, onClose, onPaid }: { open: boolean; onClose: () => void; onPaid?: () => void }) {
  const t = useTranslations('home.payment.cardForm');
  const online = useOnline();
  const [phase, setPhase] = useState<Phase>('loading');
  const [start, setStart] = useState<Start | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const cardRef = useRef<StripeCardElement | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);

  const say = (code: string) => setError(KNOWN.has(code) ? t(`errors.${code}`) : t('errors.generic'));

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    setQuote(null);
    try {
      const s = await post<Start>({ step: 'start' });
      setStart(s);
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(s.publishableKey, { stripeAccount: s.stripeAccount });
      if (!stripe) throw new Error('failed');
      stripeRef.current = stripe;
      // Stripe's card field: cards only (never another kind of payment), drawn
      // in Stripe's own frame in the app's colours.
      const css = getComputedStyle(document.documentElement);
      const ink = css.getPropertyValue('--text-primary').trim() || undefined;
      const muted = css.getPropertyValue('--text-muted').trim() || undefined;
      cardRef.current?.destroy();
      cardRef.current = stripe.elements().create('card', {
        hidePostalCode: false,
        style: { base: { color: ink, fontSize: '16px', '::placeholder': { color: muted } } },
      });
      setPhase('card');
    } catch (e) {
      say(e instanceof Error ? e.message : 'failed');
      setPhase('failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening the sheet starts a fresh form.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Stripe's card field mounts once the sheet has drawn the box for it.
  useEffect(() => {
    if (phase !== 'card' || !cardRef.current || !mountRef.current) return;
    const el = cardRef.current;
    el.mount(mountRef.current);
    return () => el.unmount();
  }, [phase]);

  async function check() {
    const stripe = stripeRef.current;
    const card = cardRef.current;
    if (!stripe || !card) return;
    setError(null);
    setPhase('checking');
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({ type: 'card', card });
    if (pmError || !paymentMethod) {
      setError(pmError?.message ?? t('errors.generic'));
      setPhase('card');
      return;
    }
    try {
      setQuote(await post<Quote>({ step: 'quote', paymentMethodId: paymentMethod.id }));
      setPhase('review');
    } catch (e) {
      say(e instanceof Error ? e.message : 'failed');
      setPhase('card');
    }
  }

  async function pay() {
    const stripe = stripeRef.current;
    if (!stripe || !quote) return;
    setError(null);
    setPhase('paying');
    try {
      const res = await post<{ status: string; clientSecret: string | null }>({ step: 'confirm', intentId: quote.intentId, native: isNative() });
      let status = res.status;
      if (status === 'requires_action' && res.clientSecret) {
        const next = await stripe.handleNextAction({ clientSecret: res.clientSecret });
        if (next.error) throw new Error(next.error.code === 'card_declined' ? 'card_declined' : 'failed');
        status = next.paymentIntent?.status ?? 'failed';
      }
      if (status !== 'succeeded' && status !== 'processing') throw new Error('failed');
      setPhase('done');
      // The webhook marks the lines paid a moment after Stripe says done.
      announceBalanceChanged();
      window.setTimeout(announceBalanceChanged, 4000);
      onPaid?.();
    } catch (e) {
      say(e instanceof Error ? e.message : 'failed');
      setPhase('review');
    }
  }

  // Cents always, here: the fee is cents, and "$27" beside "$27.64" reads as two kinds of number.
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between" style={{ gap: 'var(--space-3)' }}>
      <span className={strong ? 'fs-md' : 'fs-sm'} style={{ color: strong ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: strong ? 600 : undefined }}>
        {label}
      </span>
      <span className={strong ? 'fs-md' : 'fs-sm'} style={{ fontFamily: 'var(--font-mono)', fontWeight: strong ? 700 : undefined }}>{value}</span>
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('close')}>
        {t('title')}
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }} data-testid="card-pay-sheet" data-phase={phase}>
          {start && phase !== 'done' && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
              {t('feeNote', { pct: pct(start.bps) })}
            </p>
          )}

          {phase === 'loading' && <div className="shimmer-line" style={{ height: 'var(--space-9)', borderRadius: 'var(--radius-lg)' }} aria-busy="true" />}

          {(phase === 'card' || phase === 'checking') && (
            <>
              {start && row(t('owe'), money(start.amountCents), true)}
              <div ref={mountRef} className="card-field" data-testid="card-field" />
            </>
          )}

          {(phase === 'review' || phase === 'paying') && quote && (
            <div className="cc-mini-card flex flex-col" style={{ gap: 'var(--space-2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }} data-testid="card-pay-review">
              {quote.last4 && (
                <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('cardLine', { brand: (quote.brand ?? '').toUpperCase(), last4: quote.last4, funding: t(`funding.${['credit', 'debit', 'prepaid'].includes(quote.funding) ? quote.funding : 'unknown'}`) })}
                </span>
              )}
              {row(t('owe'), money(quote.baseCents))}
              {quote.feeCents > 0
                ? row(t('fee', { pct: pct(quote.bps) }), money(quote.feeCents))
                : row(t('noFee'), money(0))}
              <div style={{ paddingTop: 'var(--space-2)' }}>{row(t('total'), money(quote.totalCents), true)}</div>
              <button type="button" className="link-quiet link-quiet--flush" style={{ alignSelf: 'flex-start' }} onClick={() => setPhase('card')} disabled={phase === 'paying'}>
                {t('otherCard')}
              </button>
            </div>
          )}

          {phase === 'done' && (
            <p className="fs-md" role="status" style={{ margin: 0, color: 'var(--accent)', fontWeight: 600 }}>
              {t('done')}
            </p>
          )}

          {phase !== 'done' && phase !== 'loading' && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('payOther')}</p>
          )}
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        {error && <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p>}
        {phase === 'failed' ? (
          <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={!online} onClick={() => void load()}>
            {t('retry')}
          </button>
        ) : phase === 'done' ? (
          <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onClose}>
            {t('close')}
          </button>
        ) : phase === 'review' || phase === 'paying' ? (
          <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={!online || phase === 'paying'} onClick={() => void pay()} data-testid="card-pay-confirm">
            <span className="material-icons icon-md" aria-hidden="true">lock</span>
            {phase === 'paying' ? t('paying') : t('pay', { amount: money(quote?.totalCents ?? 0) })}
          </button>
        ) : (
          <button type="button" className="btn-primary" style={{ width: '100%' }} disabled={!online || phase !== 'card'} onClick={() => void check()} data-testid="card-pay-continue">
            {phase === 'checking' ? t('checking') : t('continue')}
          </button>
        )}
      </BottomSheetFooter>
    </BottomSheet>
  );
}
