'use client';

import { useLocale, useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
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

  function handleClose() {
    if (releases.length > 0) {
      localStorage.setItem('badminton_last_read_release', releases[0].version);
    }
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      ariaLabel={t('sheetLabel')}
      className="terminal-sheet"
    >
      <BottomSheetHeader className="terminal-titlebar flex items-center justify-between">
        <span className="terminal-prompt">bpm-changelog</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={t('close')}
          className="terminal-prompt transition-colors"
        >
          <span className="material-icons" style={{ fontSize: '16px' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-20">
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
      </BottomSheetBody>
    </BottomSheet>
  );
}
