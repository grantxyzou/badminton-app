'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import { isIOS } from '@/lib/standalone';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * "Add to Home Screen" instructions. iOS never shows an automatic install
 * prompt (you go through Share → Add to Home Screen), and we ship no service
 * worker so Android has no auto-prompt either — so the group needs to be told
 * how. Detects the platform and leads with the matching steps.
 */
export default function InstallSheet({ open, onClose }: Props) {
  const t = useTranslations('install');
  // Resolve platform after mount (UA isn't available during SSR).
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setIos(isIOS());
  }, []);

  const steps = ios
    ? [
        { icon: 'ios_share', text: t('ios.step1') },
        { icon: 'add_to_home_screen', text: t('ios.step2') },
        { icon: 'check_circle', text: t('ios.step3') },
      ]
    : [
        { icon: 'more_vert', text: t('android.step1') },
        { icon: 'add_to_home_screen', text: t('android.step2') },
        { icon: 'check_circle', text: t('android.step3') },
      ];

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader className="flex items-center justify-between">
        <span className="bpm-h3" style={{ margin: 0 }}>{t('title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="cc-btn cc-btn-ghost"
          style={{ padding: 6 }}
        >
          <span className="material-icons" aria-hidden="true" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-20" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
          {t('intro')}
        </p>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span
                aria-hidden="true"
                style={{
                  flex: '0 0 auto',
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-lg)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--glass-bg)',
                  color: 'var(--accent)',
                }}
              >
                <span className="material-icons" style={{ fontSize: 18 }}>{s.icon}</span>
              </span>
              <span style={{ fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', lineHeight: 'var(--lh-normal, 1.5)' }}>
                {s.text}
              </span>
            </li>
          ))}
        </ol>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          {/* Note points readers on the OTHER platform to their steps:
              ios.note describes the Android way, android.note the iOS way. */}
          {ios ? t('ios.note') : t('android.note')}
        </p>
        <button type="button" onClick={onClose} className="cc-btn cc-btn-primary cc-btn-lg">
          {t('done')}
        </button>
      </BottomSheetBody>
    </BottomSheet>
  );
}
