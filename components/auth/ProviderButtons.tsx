'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Provider = 'google' | 'apple';

interface Props {
  /**
   * `signin` on the anonymous Profile view, `link` when an already-signed-in
   * member is connecting a provider. Only changes the label — the server
   * decides between signing in and linking from the `member_session` cookie,
   * because a client-supplied intent would be trivially forgeable.
   */
  mode?: 'signin' | 'link';
  /** Providers already linked to this member; rendered as connected, not tappable. */
  linked?: Provider[];
}

/**
 * The Google / Apple buttons.
 *
 * These are plain links, not fetch calls: an OAuth flow is a full-page
 * navigation to the provider and back. Doing it with fetch would hit CORS on
 * the consent page and lose the redirect entirely.
 *
 * WHAT IT RENDERS WHEN IT DOESN'T KNOW: nothing. `available === null` means the
 * probe failed or was throttled, which is NOT the same as "no providers
 * configured" — showing zero buttons on a rate-limited read would look exactly
 * like the feature being off. Unknown renders empty and retries on next mount;
 * known-empty renders empty for real. (The lying-empty-state rule, applied to a
 * capability probe rather than to data.)
 */
export default function ProviderButtons({ mode = 'signin', linked = [] }: Props) {
  const t = useTranslations('profile.auth');
  const online = useOnline();
  const [available, setAvailable] = useState<Provider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setAvailable(Array.isArray(d.available) ? (d.available as Provider[]) : null);
      })
      .catch(() => {
        // Stays null — unknown, not known-empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available || available.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {available.map((p) => {
        const isLinked = linked.includes(p);
        const label = isLinked
          ? t(p === 'google' ? 'googleConnected' : 'appleConnected')
          : t(
              mode === 'link'
                ? p === 'google'
                  ? 'connectGoogle'
                  : 'connectApple'
                : p === 'google'
                  ? 'continueGoogle'
                  : 'continueApple',
            );

        if (isLinked) {
          return (
            <div
              key={p}
              className="cc-mini-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                color: 'var(--text-secondary)',
                fontSize: 'var(--fs-md)',
              }}
            >
              <span className="material-icons icon-sm" style={{ color: 'var(--accent)' }}>
                check_circle
              </span>
              {label}
            </div>
          );
        }

        return (
          <a
            key={p}
            href={online ? `${BASE}/api/auth/${p}/start` : undefined}
            aria-disabled={!online}
            className="cc-btn cc-btn-secondary"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-3)',
              textDecoration: 'none',
              // Matches .cc-btn:disabled rather than inventing a new disabled
              // look — the design system's rule for a not-currently-actionable
              // control.
              ...(online ? {} : { opacity: 0.5, pointerEvents: 'none' as const }),
            }}
          >
            {label}
          </a>
        );
      })}
      {!online && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('offline')}</p>
      )}
    </div>
  );
}
