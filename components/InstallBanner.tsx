'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import InstallSheet from './InstallSheet';
import { isStandalone } from '@/lib/standalone';

const DISMISS_KEY = 'bpm_install_hint_dismissed';

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
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return; // dismissed before
    } catch {
      /* private mode — fall through, showing once is harmless */
    }
    // Only nudge on touch devices (skip desktop, where home-screen install
    // isn't the mental model).
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse) setShow(true);
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  if (!show) return null;

  return (
    <>
      <div
        className="glass-card"
        style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <span
          aria-hidden="true"
          className="material-icons"
          style={{ fontSize: 'var(--fs-stat-lg)', color: 'var(--accent)', flex: '0 0 auto' }}
        >
          install_mobile
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
            {t('bannerTitle')}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              margin: 0,
              padding: 0,
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
          style={{ padding: 6, flex: '0 0 auto' }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 18 }}>close</span>
        </button>
      </div>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
