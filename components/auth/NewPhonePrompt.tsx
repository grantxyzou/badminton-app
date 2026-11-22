'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { showTopToast } from '@/lib/topToast';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** How often an open app looks for a new phone asking, while it is on screen. */
const CHECK_MS = 20_000;

interface Ask {
  id: string;
  provider: 'google' | 'apple' | 'email';
  email: string | null;
  choices: number[];
}

/**
 * "Someone is signing in as you on a new phone. Is this you?"
 * (docs/plans/sign-in-redesign.md, step 3; Grant: "as Google and WhatsApp do").
 *
 * A new sign-in chose this person's name and asked their other phone instead
 * of typing a PIN (`/api/auth/claim-ask`). Every phone where they are signed
 * in gets a push, and the app shows this sheet: how the new phone signed in,
 * and three numbers. Tapping the one the new phone shows joins that sign-in
 * to this account; a wrong number or "No, it's not me" ends the ask. The
 * number is what stops a reflex yes from letting a stranger in.
 *
 * Mounted once in the signed-in shell. It looks on opening, whenever the app
 * comes back to the screen (a tapped push does that), and every 20 seconds
 * while it is visible. A read that fails shows nothing: the ask waits on the
 * server, and the next look finds it.
 */
export default function NewPhonePrompt() {
  const t = useTranslations('newPhone');
  const online = useOnline();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const look = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/auth/new-phone`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { asks?: Ask[] };
      setAsk(data.asks?.[0] ?? null);
    } catch {
      /* nothing shown; the next look finds it */
    }
  }, []);

  useEffect(() => {
    void look();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void look();
    };
    const timer = window.setInterval(onVisible, CHECK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [look]);

  async function answer(body: { pick: number } | { notMe: true }) {
    if (!ask || busy || !online) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/auth/new-phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ask.id, ...body }),
      });
      const data = (await res.json().catch(() => ({}))) as { outcome?: string };
      if (!res.ok && res.status !== 404) {
        setError(true);
        return;
      }
      setAsk(null);
      if (data.outcome === 'approved') {
        showTopToast({ tone: 'success', icon: 'check_circle', title: t('approvedTitle'), body: t('approvedBody') });
      } else if (data.outcome === 'stopped') {
        showTopToast({ tone: 'warn', icon: 'shield', title: t('stoppedTitle'), body: t('stoppedBody') });
      }
      // A 404: already answered elsewhere. Nothing to say; the next look shows what is left.
      void look();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const open = !!ask && ask.id !== dismissed;
  const method = ask?.provider === 'google' ? t('viaGoogle') : ask?.provider === 'apple' ? t('viaApple') : t('viaEmail');

  return (
    <BottomSheet open={open} onClose={() => setDismissed(ask?.id ?? null)} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={() => setDismissed(ask?.id ?? null)} closeLabel={t('later')}>
        <h2 className="bpm-h3" style={{ margin: 0 }}>
          {t('title')}
        </h2>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div className="flex flex-col gap-3">
          <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('body')}
          </p>
          <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {method}
            {ask?.email ? ` · ${ask.email}` : ''}
          </p>
          <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {t('pick')}
          </p>
        </div>
      </BottomSheetBody>
      <BottomSheetFooter>
        {error && (
          <p className="field-warn" role="alert">
            {t('failed')}
          </p>
        )}
        <div className="new-phone-choices" role="group" aria-label={t('pick')}>
          {(ask?.choices ?? []).map((n) => (
            <button
              key={n}
              type="button"
              className="new-phone-choice"
              disabled={busy || !online}
              aria-label={t('pickNumber', { number: String(n) })}
              onClick={() => void answer({ pick: n })}
            >
              {n}
            </button>
          ))}
        </div>
        <button type="button" className="link-quiet" disabled={busy || !online} onClick={() => void answer({ notMe: true })}>
          {t('notMe')}
        </button>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
