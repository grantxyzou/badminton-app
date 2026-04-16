'use client';

import { useTranslations } from 'next-intl';

interface WelcomeCardProps {
  onDismiss: () => void;
}

export default function WelcomeCard({ onDismiss }: WelcomeCardProps) {
  const t = useTranslations('home.welcome');

  return (
    <div className="glass-card p-5 space-y-3 relative">
      <button
        type="button"
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-200 transition-colors"
        onClick={onDismiss}
        aria-label={t('dismiss')}
      >
        <span className="material-icons" style={{ fontSize: '18px' }}>close</span>
      </button>
      <p className="text-lg font-bold text-gray-200">{t('title')}</p>
      <ul className="space-y-1.5 text-sm text-gray-300">
        <li>{t('schedule')}</li>
        <li>{t('invite')}</li>
        <li>{t('payment')}</li>
      </ul>
      <p className="text-xs text-gray-400">{t('help')}</p>
    </div>
  );
}
