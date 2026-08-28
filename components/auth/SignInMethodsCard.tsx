'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import ProviderButtons from './ProviderButtons';
import { useSignInMethods, type Provider, type UseSignInMethods } from './useSignInMethods';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The single place a signed-in member manages how they get back in.
 *
 * WHY THIS REPLACED THE NUDGE-ONLY CARD
 * -------------------------------------
 * The upgrade nudge only rendered when the server said `nudge: true`, which
 * requires `hasPin`. That left a hole: anyone who signed up with Google or with
 * an email — i.e. every account created by the new flows — had NO route to
 * connect a second provider, because the nudge was correctly suppressed for
 * them and there was nowhere else to go. A Google user could never add Apple,
 * and nobody could disconnect anything.
 *
 * So this card is always present for a signed-in member, and the nudge is now a
 * variant of it rather than a separate surface. One card, one place to look.
 *
 * It distinguishes UNKNOWN from EMPTY throughout: a failed probe renders an
 * explicit error, never a confident "you have no sign-in methods", which would
 * be the lying-empty-state failure applied to the scariest possible subject.
 */
export interface SignInMethodsCardProps {
  /**
   * A shared `useSignInMethods()` instance. Pass it when the caller already
   * reads this endpoint (Profile does, for the row's summary) so the row and
   * this body cannot disagree about what is connected. Omitted, the card opens
   * its own — which is what the tests and any standalone use do.
   */
  state?: UseSignInMethods;
  /**
   * Rendered inside a sheet that already carries the title and the surface.
   * Drops the glass-card chrome and the CardHeader so there is one title, not
   * two, and one card edge, not a card inside a sheet.
   */
  embedded?: boolean;
}

export default function SignInMethodsCard({ state, embedded = false }: SignInMethodsCardProps = {}) {
  const t = useTranslations('profile.auth');
  // Always called; `enabled: false` stops it opening a second fetch when the
  // caller handed us theirs.
  const fallback = useSignInMethods(!state);
  const { methods, loadError, reload: load } = state ?? fallback;
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState<Provider | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function dismissNudge() {
    setDismissed(true);
    try {
      await fetch(`${BASE}/api/auth/nudge`, { method: 'POST' });
    } catch {
      // They see it again in a while. Acceptable; a stuck card is not.
    }
  }

  async function disconnect(provider: Provider) {
    setActionError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/identity`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The refusal that matters: this was their only way back in.
        setActionError(data.error === 'last_credential' ? t('lastCredential') : t('disconnectFailed'));
        return;
      }
      setConfirming(null);
      await load();
    } catch {
      setActionError(t('disconnectFailed'));
    }
  }

  if (loadError) {
    return embedded ? (
      <ErrorState message={t('methodsLoadError')} />
    ) : (
      <div className="glass-card p-5 space-y-3">
        <CardHeader icon="lock" title={t('methodsTitle')} />
        <ErrorState message={t('methodsLoadError')} />
      </div>
    );
  }
  if (!methods) return null;

  const linked = methods.linked ?? [];
  const showNudge = methods.nudge === true && !dismissed;

  return (
    <div
      className={embedded ? '' : 'glass-card p-5 animate-fadeIn'}
      style={{ display: 'grid', gap: 'var(--space-4)' }}
    >
      {!embedded && (
        <CardHeader
          icon="lock"
          title={showNudge ? t('nudgeTitle') : t('methodsTitle')}
          subtitle={showNudge ? t('nudgeSubtitle') : t('methodsSubtitle')}
        />
      )}

      {/* What they already have. Rendered as facts, not actions — the PIN and
          password are managed elsewhere on Profile. */}
      <ul style={{ display: 'grid', gap: 'var(--space-2)', margin: '0', padding: '0', listStyle: 'none' }}>
        {methods.hasPin && <MethodRow label={t('methodPin')} />}
        {methods.hasPassword && <MethodRow label={methods.email || t('methodPassword')} />}
        {linked.map((p) => (
          <li key={p} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span className="material-icons icon-sm" style={{ color: 'var(--accent)' }}>
              check_circle
            </span>
            <span style={{ flex: 1, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>
              {t(p === 'google' ? 'googleConnected' : 'appleConnected')}
            </span>
            {confirming === p ? (
              <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button type="button" onClick={() => disconnect(p)} className="cc-btn cc-btn-danger">
                  {t('disconnectConfirm')}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="cc-btn cc-btn-ghost">
                  {t('disconnectCancel')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirming(p);
                  setActionError(null);
                }}
                className="cc-btn cc-btn-ghost"
              >
                {t('disconnect')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {showNudge && methods.hasPin && !methods.hasPassword && linked.length === 0 && (
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: '0' }}>
          {t('methodPinOnly')}
        </p>
      )}

      {actionError && <p className="field-error">{actionError}</p>}

      {/* Anything not yet connected. ProviderButtons renders nothing when the
          deployment has no credentials, or when the probe failed. */}
      <ProviderButtons mode="link" linked={linked} />

      {showNudge && (
        <button type="button" onClick={dismissNudge} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
          {t('nudgeDismiss')}
        </button>
      )}
    </div>
  );
}

function MethodRow({ label }: { label: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      <span className="material-icons icon-sm" style={{ color: 'var(--accent)' }}>
        check_circle
      </span>
      <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{label}</span>
    </li>
  );
}
