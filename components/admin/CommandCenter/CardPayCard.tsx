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

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The not-yet-connected card on the mock store at 430px. */
const SKELETON_HEIGHT = 168;

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'organiserOnly' }
  | { kind: 'unconfigured' }
  | { kind: 'ready'; connected: boolean; chargesEnabled: boolean; stripeAccountId?: string };

export default function CardPayCard() {
  const online = useOnline();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [connect, setConnect] = useState<'idle' | 'busy' | 'error'>('idle');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/admin/card-pay`, { cache: 'no-store' });
      if (res.status === 403) return setStatus({ kind: 'organiserOnly' });
      if (res.status === 404) return setStatus({ kind: 'unconfigured' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { connected: boolean; chargesEnabled: boolean; stripeAccountId?: string };
      setStatus({ kind: 'ready', connected: body.connected, chargesEnabled: body.chargesEnabled, stripeAccountId: body.stripeAccountId });
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
        </>
      )}
    </div>
  );
}
