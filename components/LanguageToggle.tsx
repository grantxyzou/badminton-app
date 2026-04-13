'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'zh-CN', label: '中文' },
] as const;

export default function LanguageToggle() {
  const current = useLocale();
  const router = useRouter();

  function setLocale(next: string) {
    if (next === current) return;
    const secure = typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
    document.cookie = `NEXT_LOCALE=${next}; path=/bpm; max-age=31536000; SameSite=Lax${secure}`;
    router.refresh();
  }

  return (
    <div className="segment-control" role="radiogroup" aria-label="Language">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={code === current}
          className={code === current ? 'segment-tab-active' : 'segment-tab-inactive'}
          onClick={() => setLocale(code)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
