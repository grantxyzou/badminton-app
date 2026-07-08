'use client';

import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';

/**
 * Stats tab empty state for a signed-out visitor (no identity, no stats
 * preview-name). Standalone centered text + ghost action per the project's
 * error/empty-state convention — not a glass-card. Sign-in lives on Profile,
 * so the action routes there.
 */
export default function StatsSignedOut({ onSignIn }: { onSignIn?: () => void }) {
  const t = useTranslations('stats');
  return (
    <div className="space-y-5 w-full">
      <PageHeader>{t('heading')}</PageHeader>
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-xl)', color: 'var(--text-muted)', opacity: 0.7 }}>
          trending_up
        </span>
        <p className="bpm-h3" style={{ color: 'var(--text-primary)', margin: 0 }}>
          {t('assess.signedOutTitle')}
        </p>
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0, maxWidth: 280, lineHeight: 1.5 }}>
          {t('assess.signedOutBody')}
        </p>
        {onSignIn && (
          <button type="button" onClick={onSignIn} className="cc-btn cc-btn-ghost" style={{ marginTop: 4 }}>
            {t('assess.signIn')}
          </button>
        )}
      </div>
    </div>
  );
}
