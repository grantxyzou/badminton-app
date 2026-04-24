'use client';

import { useEffect, useState } from 'react';
import { isPreviewEnv } from '@/lib/flags';

const BANNER_HEIGHT = 28;
const REPO = 'grantxyzou/badminton-app';
const FEEDBACK_EMAIL = 'xyzou2012@gmail.com';

export default function PreviewBanner() {
  const show = isPreviewEnv();
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!show) return;
    document.documentElement.style.setProperty('--banner-offset', `${BANNER_HEIGHT}px`);
    return () => {
      document.documentElement.style.removeProperty('--banner-offset');
    };
  }, [show]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [pickerOpen]);

  if (!show) return null;

  const sha = (process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev').slice(0, 7);

  function issueUrl(template: 'bug.yml' | 'feature.yml') {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const params = new URLSearchParams({
      template,
      url,
      sha,
      ua,
    });
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          padding: '6px 12px',
          textAlign: 'center',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          background: 'linear-gradient(90deg, #f59e0b, #f97316)',
          color: '#111',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        }}
      >
        preview bpm vnext · {sha} not the stable site ·{' '}
        <button
          type="button"
          onClick={() => setPickerOpen((p) => !p)}
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          style={{
            color: '#111',
            textDecoration: 'underline',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            padding: 0,
          }}
        >
          report a bug / idea
        </button>
      </div>
      <div style={{ height: BANNER_HEIGHT }} aria-hidden="true" />

      {pickerOpen && (
        <>
          <div
            onClick={() => setPickerOpen(false)}
            aria-hidden="true"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9998,
              background: 'rgba(0,0,0,0.4)',
            }}
          />
          <div
            role="menu"
            aria-label="Report options"
            style={{
              position: 'fixed',
              top: BANNER_HEIGHT + 8,
              right: 12,
              zIndex: 10000,
              background: 'var(--bg-elevated, #1a1a1a)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              minWidth: 220,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <a
              role="menuitem"
              href={issueUrl('bug.yml')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPickerOpen(false)}
              style={{
                padding: '10px 12px',
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-primary, #fff)',
                textDecoration: 'none',
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 18, color: '#ef4444' }}>
                error
              </span>
              Report a bug
            </a>
            <a
              role="menuitem"
              href={issueUrl('feature.yml')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setPickerOpen(false)}
              style={{
                padding: '10px 12px',
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-primary, #fff)',
                textDecoration: 'none',
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 18, color: 'var(--accent, #22c55e)' }}>
                auto_fix_high
              </span>
              Suggest a feature
            </a>
            <a
              role="menuitem"
              href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(`bpm-next feedback · ${sha}`)}`}
              onClick={() => setPickerOpen(false)}
              style={{
                padding: '10px 12px',
                minHeight: 44,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-muted, #aaa)',
                textDecoration: 'none',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 18 }}>
                schedule
              </span>
              Private email instead
            </a>
          </div>
        </>
      )}
    </>
  );
}
