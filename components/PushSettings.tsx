'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import type { UsePushResult } from '@/lib/usePush';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** Opens the "Add to Home Screen" instructions — the only actionable path
   *  for an iOS user in a browser tab, where push is unavailable by design. */
  onOpenInstall: () => void;
  /** Owned by HomeShell and shared with Profile's row, so toggling here
   *  updates the row's On/Off label immediately. A second usePush() would be a
   *  separate state (and, in the store app, a second token listener). */
  push: UsePushResult;
  /** Admins get a "send a test notification" button: POST /api/push/test
   *  targets only the caller's own devices, so it is the way to prove the
   *  transport (VAPID, or FCM/APNs on the native shell) on a real phone. */
  isAdmin?: boolean;
}

type TestOutcome =
  | { kind: 'sent'; count: number }
  | { kind: 'none' }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

/**
 * Notification opt-in — the top of the Notifications page in the STORE APP
 * (docs/plans/notification-center.md). On the web the page leads with the
 * get-the-app card instead, and shows this only to someone whose browser
 * already has push on, so they can still turn it off.
 *
 * Every terminal state is rendered honestly rather than collapsed into a
 * generic "not available": a user who CAN fix their situation is told how, and
 * a user who cannot is told plainly instead of being offered a button that
 * silently does nothing.
 */
export default function PushSettings({ onOpenInstall, push, isAdmin = false }: Props) {
  const t = useTranslations('profile.push');
  const online = useOnline();
  const { state, enable, disable, busy, error } = push;
  const [testing, setTesting] = useState(false);
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null);

  async function sendTest() {
    setTesting(true);
    setTestOutcome(null);
    try {
      const res = await fetch(`${BASE}/api/push/test`, { method: 'POST', cache: 'no-store' });
      if (res.status === 503) { setTestOutcome({ kind: 'not-configured' }); return; }
      if (!res.ok) { setTestOutcome({ kind: 'failed' }); return; }
      const data = (await res.json()) as { sent?: number };
      const sent = typeof data.sent === 'number' ? data.sent : 0;
      setTestOutcome(sent > 0 ? { kind: 'sent', count: sent } : { kind: 'none' });
    } catch {
      setTestOutcome({ kind: 'failed' });
    } finally {
      setTesting(false);
    }
  }

  function body() {
    if (state.status === 'loading') {
      return <p className="fs-base" style={{ color: 'var(--text-muted)' }}>{t('checking')}</p>;
    }

    if (state.status === 'unsupported') {
      if (state.reason === 'ios-not-installed') {
        return (
          <>
            <p className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('iosNeedsInstall')}</p>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ marginTop: 'var(--space-4)', width: '100%' }}
              onClick={onOpenInstall}
            >
              {t('iosInstallCta')}
            </button>
          </>
        );
      }
      return (
        <p className="fs-base" style={{ color: 'var(--text-muted)' }}>
          {state.reason === 'not-configured' ? t('notConfigured') : t('unsupported')}
        </p>
      );
    }

    if (state.status === 'denied') {
      // requestPermission() resolves 'denied' immediately without prompting,
      // so there is genuinely no button we could offer here.
      return <p className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('blocked')}</p>;
    }

    const isOn = state.status === 'on';
    return (
      <>
        {isOn ? (
          <p className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('onBody')}</p>
        ) : (
          <>
            <p className="fs-md" style={{ color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>{t('offTitle')}</p>
            <p className="fs-base" style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>{t('offBody')}</p>
          </>
        )}
        {!online && (
          <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
            {t('offlineHint')}
          </p>
        )}
        {/* Signed out is a refusal, not a failure — muted, not red. */}
        {error === 'auth' && (
          // `status`, not `alert`: it still answers the tap for a screen reader,
          // politely, without announcing a failure that did not happen.
          <p className="fs-base" role="status" style={{ marginTop: 'var(--space-3)', marginBottom: 0, color: 'var(--text-muted)' }}>
            {t('errorAuth')}
          </p>
        )}
        {error && error !== 'auth' && (
          <p className="field-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
            {t('errorGeneric')}
          </p>
        )}
        <button
          type="button"
          className={`cc-btn ${isOn ? 'cc-btn-secondary' : 'cc-btn-primary'} cc-btn-lg`}
          style={{ marginTop: 'var(--space-4)', width: '100%' }}
          // Network-mutating action — must be unavailable offline rather than
          // failing after the tap (CLAUDE.md offline posture).
          disabled={busy || !online}
          onClick={() => void (isOn ? disable() : enable())}
        >
          {busy ? t('working') : isOn ? t('turnOff') : t('turnOn')}
        </button>
        {isAdmin && isOn && (
          <>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              style={{ marginTop: 'var(--space-3)', width: '100%' }}
              disabled={testing || !online}
              onClick={() => void sendTest()}
            >
              {testing ? t('testSending') : t('testSend')}
            </button>
            {testOutcome && (
              <p
                className={testOutcome.kind === 'sent' ? 'fs-sm' : 'field-error'}
                role={testOutcome.kind === 'sent' ? undefined : 'alert'}
                style={{ marginTop: 'var(--space-2)', ...(testOutcome.kind === 'sent' ? { color: 'var(--text-secondary)' } : {}) }}
              >
                {testOutcome.kind === 'sent'
                  ? t('testSent', { count: testOutcome.count })
                  : testOutcome.kind === 'none'
                    ? t('testNone')
                    : testOutcome.kind === 'not-configured'
                      ? t('testNotConfigured')
                      : t('testFailed')}
              </p>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <section aria-label={t('title')}>
      {/* Keyed on the state, so "Checking…" → on/off/blocked crossfades
          instead of swapping copy under the reader. */}
      <div key={state.status} className="motion-fade">{body()}</div>
    </section>
  );
}
