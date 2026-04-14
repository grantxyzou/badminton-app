'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

const NEXT_LOCALE: Record<string, { code: string; ariaTo: string }> = {
  en: { code: 'zh-CN', ariaTo: '中文' },
  'zh-CN': { code: 'en', ariaTo: 'English' },
};

export default function LanguageToggle() {
  const current = useLocale();
  const router = useRouter();
  const next = NEXT_LOCALE[current] ?? NEXT_LOCALE.en;

  function toggle() {
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
    document.cookie = `NEXT_LOCALE=${next.code}; path=/bpm; max-age=31536000; SameSite=Lax${secure}`;
    router.refresh();
  }

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={toggle}
      aria-label={`Switch to ${next.ariaTo}`}
      title={`Switch to ${next.ariaTo}`}
    >
      <span className="material-icons">translate</span>
    </button>
  );
}
