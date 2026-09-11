'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import InstallSheet from './InstallSheet';
import { isStandalone } from '@/lib/standalone';
import { isNative } from '@/lib/native';
import { readStored, useClientValue } from '@/lib/useClientValue';

const DISMISS_KEY = 'bpm_install_hint_dismissed';

/**
 * Is this device one we should nudge at all? Entirely a question about the
 * environment, so it is read rather than stored — and `false` is the right
 * server answer, since `isStandalone()`/`isNative()` both treat `false` as
 * "unknown" and an unknown must not make the banner appear during hydration.
 */
function shouldNudge(): boolean {
  if (isStandalone() || isNative()) return false; // already installed, or IS the app
  if (readStored(DISMISS_KEY) === '1') return false; // dismissed before
  // Only nudge on touch devices (skip desktop, where home-screen install
  // isn't the mental model).
  try {
    return window.matchMedia?.('(pointer: coarse)').matches === true;
  } catch {
    return false;
  }
}

/**
 * One-time, dismissible nudge to add BPM to the home screen. Shown only in a
 * mobile browser that isn't already the installed standalone app, and never
 * again once dismissed. iOS has no automatic install prompt and we ship no
 * service worker (so Android has none either), so this is how the group learns
 * the app is installable. "Show me how" opens the same InstallSheet as the
 * Profile row.
 */
export default function InstallBanner() {
  const t = useTranslations('install');
  const eligible = useClientValue(shouldNudge, false);
  // Dismissal is the one piece of genuine local state: the write below is what
  // makes it stick across visits, but `shouldNudge` is not re-read on a plain
  // re-render in private mode, where the write is swallowed.
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode — dismissed for this page view only */
    }
  };

  if (!eligible || dismissed) return null;

  return (
    <>
      <div
        className="glass-card p-4"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}
      >
        <span
          aria-hidden="true"
          className="material-icons"
          style={{ fontSize: 'var(--fs-stat-lg)', color: 'var(--accent)', flex: '0 0 auto' }}
        >
          install_mobile
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0', fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
            {t('bannerTitle')}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              margin: '0',
              padding: '0',
              background: 'none',
              border: 'none',
              fontSize: 'var(--fs-sm)',
              color: 'var(--accent)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('bannerCta')}
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="cc-btn cc-btn-ghost"
          style={{ padding: 'var(--space-2)', flex: '0 0 auto' }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>close</span>
        </button>
      </div>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
