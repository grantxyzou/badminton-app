'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ProviderButtons from './ProviderButtons';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Provider = 'google' | 'apple';

interface Methods {
  available: Provider[] | null;
  linked: Provider[] | null;
  hasPassword?: boolean;
  hasPin?: boolean;
  nudge?: boolean;
}

/**
 * The upgrade nudge for members who still sign in with a PIN alone.
 *
 * Renders NOTHING unless the server says `nudge: true`. The policy lives in
 * `lib/authNudge.ts` and is evaluated server-side on purpose — dismissal is
 * stored on the member, so a client-side re-derivation would disagree with the
 * server the moment the same person opened the app on a second device.
 *
 * Copy is a friend asking a favour, not a bank issuing a policy: "so you can
 * get back in if you forget your PIN", never "upgrade your authentication
 * method". The PIN is not being retired and this must never read as a deadline.
 */
export default function SecureAccountCard() {
  const t = useTranslations('profile.auth');
  const [methods, setMethods] = useState<Methods | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setMethods(d as Methods);
      })
      .catch(() => {
        // Unknown stays unknown: no card, rather than a card built on a guess.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismiss() {
    // Optimistic: the nudge is the definition of low-stakes, and making someone
    // watch a spinner to dismiss a suggestion is worse than a lost write.
    setDismissed(true);
    try {
      await fetch(`${BASE}/api/auth/nudge`, { method: 'POST' });
    } catch {
      // If it fails they see it again in a while. Acceptable.
    }
  }

  if (dismissed || !methods?.nudge) return null;

  return (
    <div className="glass-card p-5 animate-fadeIn" style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <CardHeader icon="lock" title={t('nudgeTitle')} subtitle={t('nudgeSubtitle')} />
      <ProviderButtons mode="link" linked={methods.linked ?? []} />
      <button
        type="button"
        onClick={dismiss}
        className="cc-btn cc-btn-ghost"
        style={{ width: '100%' }}
      >
        {t('nudgeDismiss')}
      </button>
    </div>
  );
}
