'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import ProviderButtons from './ProviderButtons';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Provider = 'google' | 'apple';

interface Methods {
  available: Provider[] | null;
  linked: Provider[] | null;
  hasPassword?: boolean;
  hasPin?: boolean;
  email?: string | null;
  nudge?: boolean;
}

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
export default function SignInMethodsCard() {
  const t = useTranslations('profile.auth');
  const [methods, setMethods] = useState<Methods | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState<Provider | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as Methods;
      if (d.linked === null) throw new Error('unknown');
      setMethods(d);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    return (
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
    <div className="glass-card p-5 animate-fadeIn" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <CardHeader
        icon="lock"
        title={showNudge ? t('nudgeTitle') : t('methodsTitle')}
        subtitle={showNudge ? t('nudgeSubtitle') : t('methodsSubtitle')}
      />

      {/* What they already have. Rendered as facts, not actions — the PIN and
          password are managed elsewhere on Profile. */}
      <ul style={{ display: 'grid', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' }}>
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
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0 }}>
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
