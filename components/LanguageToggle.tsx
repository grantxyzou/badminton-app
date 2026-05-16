'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useOnline } from '@/lib/useOnline';

const NEXT_LOCALE: Record<string, { code: string; ariaTo: string }> = {
  en: { code: 'zh-CN', ariaTo: '中文' },
  'zh-CN': { code: 'en', ariaTo: 'English' },
};

export default function LanguageToggle() {
  const current = useLocale();
  const router = useRouter();
  const online = useOnline();
  const next = NEXT_LOCALE[current] ?? NEXT_LOCALE.en;

  function toggle() {
    // Switching locale requires a server re-render (router.refresh) to
    // re-resolve messages — offline that round-trip dies and breaks the
    // page. Legible-fail: refuse the action with a clear reason rather
    // than execute-then-break. (Cookie-now-refresh-later was rejected:
    // hidden state, locale silently wrong until some future navigation.)
    if (!online) return;
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
      disabled={!online}
      aria-disabled={!online}
      aria-label={online ? `Switch to ${next.ariaTo}` : 'Language switches when you’re back online'}
      title={online ? `Switch to ${next.ariaTo}` : 'Language switches when you’re back online'}
    >
      <span className="material-icons">translate</span>
    </button>
  );
}
