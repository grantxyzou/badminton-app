'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useOnline } from '@/lib/useOnline';
import { getIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const NEXT_LOCALE: Record<string, { code: string; ariaTo: string }> = {
  en: { code: 'zh-CN', ariaTo: '中文' },
  'zh-CN': { code: 'en', ariaTo: 'English' },
};

export default function LanguageToggle() {
  const current = useLocale();
  const router = useRouter();
  const online = useOnline();
  const next = NEXT_LOCALE[current] ?? NEXT_LOCALE.en;
  const t = useTranslations('a11y');
  const label = online ? t('switchLanguage', { language: next.ariaTo }) : t('languageOffline');

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
    // Pushes are written in the reader's language: tell this member's devices
    // (audit, 2026-11-05). Fire-and-forget — the page does not wait on it,
    // and a signed-out visitor has no devices to tell.
    if (getIdentity()) {
      void fetch(`${BASE}/api/push/subscribe`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next.code }),
        cache: 'no-store',
      }).catch(() => undefined);
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={toggle}
      disabled={!online}
      aria-disabled={!online}
      aria-label={label}
      title={label}
    >
      <span className="material-icons">translate</span>
    </button>
  );
}
