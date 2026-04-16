'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import type { Release } from '@/lib/types';

interface ReleaseNotesSheetProps {
  open: boolean;
  releases: Release[];
  onClose: () => void;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function ReleaseNotesSheet({ open, releases, onClose }: ReleaseNotesSheetProps) {
  const locale = useLocale() as 'en' | 'zh-CN';
  const t = useTranslations('home.releases');
  const [mounted, setMounted] = useState(false);

  // Portals must only render on the client — wait for mount so SSR pass
  // matches post-hydration DOM.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Body scroll lock while open (position:fixed technique per CLAUDE.md).
  useEffect(() => {
    if (!open) return;
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  function handleClose() {
    if (releases.length > 0) {
      localStorage.setItem('badminton_last_read_release', releases[0].version);
    }
    onClose();
  }

  if (!open || !mounted) return null;

  // Portal-render to document.body so the sheet escapes ancestor stacking
  // contexts created by backdrop-filter on glass-cards (matches DatePicker
  // pattern). Inline zIndex (not Tailwind z-[60]) prevents JIT-stripping
  // or override (matches SkillsRadar pattern).
  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/50"
        style={{ zIndex: 55 }}
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden max-h-[80vh] terminal-sheet"
        style={{ zIndex: 60 }}
        role="dialog"
        aria-label={t('sheetLabel')}
      >
        <div className="terminal-titlebar">
          <span className="terminal-prompt">bpm-changelog</span>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('close')}
            className="terminal-prompt transition-colors"
          >
            <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
          </button>
        </div>
        <div className="overflow-y-auto p-5 pb-20" style={{ maxHeight: 'calc(80vh - 40px)' }}>
          <p className="terminal-prompt mb-4">$ bpm --changelog</p>
          <ul className="space-y-6">
            {releases.map((r) => (
              <li key={r.id}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="terminal-version">▸ {r.version}</span>
                  <span className="terminal-date">· {fmtDate(r.publishedAt)}</span>
                </div>
                <h3 className="terminal-title mb-1">{r.title[locale]}</h3>
                <p className="terminal-body whitespace-pre-line">{r.body[locale]}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>,
    document.body,
  );
}
