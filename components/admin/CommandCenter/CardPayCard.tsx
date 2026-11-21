'use client';

/**
 * Card payments for the club — SANDBOX PROTOTYPE (docs/plans/card-pay-prototype.md).
 *
 * Connects the club's OWN Stripe account (Stripe Connect, direct charges), so
 * a member's card payment lands with the club and never with BPM or another
 * club. Onboarding happens on Stripe's hosted pages; this card only starts it
 * and reports whether the account can take cards yet. Organiser only, like
 * credit codes: the server answers `organiser_only` to anyone else.
 *
 * English-only, like the rest of the admin console (.claude/rules/i18n.md).
 */
import { useCallback, useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { useOnline } from '@/lib/useOnline';
import Switch from '@/components/primitives/Switch';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The not-yet-connected card on the mock store at 430px. */
const SKELETON_HEIGHT = 168;

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'organiserOnly' }
  | { kind: 'unconfigured' }
  | { kind: 'ready'; connected: boolean; chargesEnabled: boolean; stripeAccountId?: string; surcharge: Surcharge | null; cardFormReady: boolean };

/** The card fee on credit cards (docs/plans/card-surcharge.md). */
interface Surcharge {
  on: boolean;
  bps: number;
  acknowledgedAt?: string;
}

const FEE_ERRORS: Record<string, string> = {
  not_acknowledged: 'Tick the box first: Mastercard and Stripe must be told before the club adds a card fee.',
  bad_rate: 'The fee can be at most 2.4%.',
  no_publishable_key: 'The server is missing the Stripe publishable key the card form needs (STRIPE_PUBLISHABLE_KEY in App Settings).',
  changed_elsewhere: 'Someone else changed this at the same time. Close and try again.',
  organiser_only: 'Only an organiser can change the card fee.',
};

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 10 === 0 ? 1 : 2)}%`;

export default function CardPayCard() {
  const online = useOnline();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [connect, setConnect] = useState<'idle' | 'busy' | 'error'>('idle');
  const [feeSheet, setFeeSheet] = useState(false);
  const [feeBusy, setFeeBusy] = useState(false);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [told, setTold] = useState(false);
  const [rate, setRate] = useState('2.4');

  /** Turn the card fee on (from the sheet, with the box ticked) or off (straight from the switch). */
  async function saveFee(on: boolean) {
    setFeeBusy(true);
    setFeeError(null);
    try {
      const bps = Math.round(Number(rate) * 100);
      const res = await fetch(`${BASE}/api/admin/card-pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surcharge: on ? { on: true, bps, acknowledged: told } : { on: false } }),
      });
      const body = (await res.json().catch(() => null)) as { surcharge?: Surcharge; error?: string } | null;
      if (!res.ok || !body?.surcharge) {
        setFeeError(FEE_ERRORS[body?.error ?? ''] ?? 'Couldn’t save — try again.');
        return;
      }
      setStatus((s) => (s.kind === 'ready' ? { ...s, surcharge: body.surcharge! } : s));
      setFeeSheet(false);
    } catch {
      setFeeError('Couldn’t save — try again.');
    } finally {
      setFeeBusy(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/card-pay`, { cache: 'no-store' });
      if (res.status === 403) return setStatus({ kind: 'organiserOnly' });
      if (res.status === 404) return setStatus({ kind: 'unconfigured' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { connected: boolean; chargesEnabled: boolean; stripeAccountId?: string; surcharge?: Surcharge | null; cardFormReady?: boolean };
      setStatus({
        kind: 'ready',
        connected: body.connected,
        chargesEnabled: body.chargesEnabled,
        stripeAccountId: body.stripeAccountId,
        surcharge: body.surcharge ?? null,
        cardFormReady: body.cardFormReady === true,
      });
    } catch {
      setStatus({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startConnect() {
    setConnect('busy');
    try {
      const res = await fetch(`${BASE}/api/admin/card-pay`, { method: 'POST' });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) throw new Error(String(res.status));
      window.location.assign(body.url);
    } catch {
      setConnect('error');
    }
  }

  if (status.kind === 'loading') return <CardSkeleton height={SKELETON_HEIGHT} />;

  return (
    <div className="glass-card p-5 flex flex-col gap-3">
      <CardHeader icon="payments" title="Card payments" subtitle="Members pay what they owe by card." />
      {status.kind === 'error' && (
        <ErrorState
          message="Couldn't check card payments."
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              Try again
            </button>
          }
        />
      )}
      {status.kind === 'organiserOnly' && (
        <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
          Only an organiser can connect where the club&apos;s card payments go.
        </p>
      )}
      {status.kind === 'unconfigured' && (
        <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
          Card payments aren&apos;t set up on this server (no Stripe key).
        </p>
      )}
      {status.kind === 'ready' && (
        <>
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-secondary)' }}>
            {!status.connected
              ? 'Connect the club’s own Stripe account. Card payments go straight to it; Stripe takes its fee from each one.'
              : status.chargesEnabled
                ? 'Members can pay their settled sessions by card from Home.'
                : 'Stripe still needs a few details before the club can take cards.'}
          </p>
          {!status.chargesEnabled && (
            <button type="button" className="cc-btn cc-btn-primary" disabled={!online || connect === 'busy'} onClick={() => void startConnect()}>
              {status.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
            </button>
          )}
          {status.chargesEnabled && status.stripeAccountId && (
            // A full-Dashboard account logs in to Stripe on its own: payouts,
            // refunds and disputes live there, not here.
            <a
              className="cc-btn cc-btn-ghost"
              href={`https://dashboard.stripe.com/${encodeURIComponent(status.stripeAccountId)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Stripe Dashboard
              <span className="material-icons icon-sm" aria-hidden="true">open_in_new</span>
            </a>
          )}
          {connect === 'error' && <p className="field-error" role="alert">Couldn&apos;t open Stripe — try again.</p>}

          {status.chargesEnabled && (
            <div className="cc-mini-card flex flex-col" style={{ gap: 'var(--space-2)' }} data-testid="card-fee">
              <div className="flex items-center justify-between" style={{ gap: 'var(--space-3)' }}>
                <div className="flex flex-col" style={{ gap: 'var(--space-05)', minWidth: 0 }}>
                  <span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Card fee on credit cards</span>
                  <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                    {status.surcharge?.on
                      ? `On · Visa and Mastercard credit cards pay ${pct(status.surcharge.bps)} more. Debit, Amex, e-transfer and credit pay no fee.`
                      : 'Off · the club pays Stripe’s fee on every card payment.'}
                  </span>
                </div>
                <Switch
                  checked={status.surcharge?.on === true}
                  ariaLabel="Card fee on credit cards"
                  disabled={!online || feeBusy || (!status.surcharge?.on && !status.cardFormReady)}
                  onChange={(next) => {
                    setFeeError(null);
                    if (next) {
                      setTold(false);
                      setRate(status.surcharge ? String(status.surcharge.bps / 100) : '2.4');
                      setFeeSheet(true);
                    } else {
                      void saveFee(false);
                    }
                  }}
                />
              </div>
              {!status.cardFormReady && !status.surcharge?.on && (
                <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Needs the Stripe publishable key on the server first (STRIPE_PUBLISHABLE_KEY in App Settings).
                </p>
              )}
              {feeError && !feeSheet && <p className="field-error" role="alert" style={{ margin: 0 }}>{feeError}</p>}
            </div>
          )}

          <BottomSheet open={feeSheet} onClose={() => setFeeSheet(false)} ariaLabel="Turn on a card fee">
            <BottomSheetHeader onClose={() => setFeeSheet(false)} closeLabel="Close">
              Turn on a card fee
            </BottomSheetHeader>
            <BottomSheetBody>
              <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
                <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                  Members paying by credit card pay a little extra to cover part of Stripe’s fee. Canada’s card rules allow it only like this:
                </p>
                <ul className="fs-sm" style={{ margin: 0, paddingLeft: 'var(--space-6)', listStyle: 'disc', color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)' }}>
                  <li>At most <strong>2.4%</strong>, even though Stripe charges the club more.</li>
                  <li><strong>Visa and Mastercard credit cards only.</strong> Debit, prepaid, American Express and other cards pay nothing; the app checks the card before charging.</li>
                  <li>The fee is <strong>shown before they pay</strong>, and they can pay by e-transfer instead.</li>
                  <li>A refund gives back its share of the fee.</li>
                  <li>Not allowed for a club in <strong>Quebec</strong>.</li>
                </ul>
                <label className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
                  <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>Fee on credit cards (%)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.1}
                    max={2.4}
                    step={0.1}
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    style={{ maxWidth: 'calc(var(--space-9) * 2.5)' }}
                    data-testid="card-fee-rate"
                  />
                </label>
                <label className="cc-checkbox" style={{ alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={told} onChange={(e) => setTold(e.target.checked)} data-testid="card-fee-told" />
                  <span className="fs-sm" style={{ lineHeight: 'var(--lh-normal)' }}>
                    I’ve told Mastercard and Stripe that the club will add a card fee on credit cards.
                  </span>
                </label>
              </div>
            </BottomSheetBody>
            <BottomSheetFooter>
              {feeError && <p className="field-error" role="alert" style={{ margin: 0 }}>{feeError}</p>}
              <button
                type="button"
                className="btn-primary"
                style={{ width: '100%' }}
                disabled={!online || feeBusy || !told}
                onClick={() => void saveFee(true)}
                data-testid="card-fee-confirm"
              >
                {feeBusy ? 'Saving…' : 'Turn on the card fee'}
              </button>
            </BottomSheetFooter>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
