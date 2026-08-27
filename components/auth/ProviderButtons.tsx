'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type Provider = 'google' | 'apple';

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
  /**
   * Availability already resolved by the SERVER, which skips the probe below.
   *
   * Which providers exist is decided entirely by environment variables, so the
   * server knows it at render time and the client cannot learn anything the
   * server did not already have. Passing it in matters on the anonymous Profile
   * card, where these buttons now lead: probing for them would paint the card
   * form-first and then shove everything down when the answer arrives. Same
   * class of problem as resolving the visual-fields flag post-hydration, and
   * solved the same way — on the server, before the first paint.
   *
   * Omit it and the component probes as before. `SignInMethodsCard` does, since
   * it needs `linked` from the same endpoint anyway and sits far below the fold.
   */
  available?: Provider[];
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
export default function ProviderButtons({
  mode = 'signin',
  linked = [],
  available: given,
}: Props) {
  const t = useTranslations('profile.auth');
  const online = useOnline();
  const [probed, setProbed] = useState<Provider[] | null>(null);

  useEffect(() => {
    // The server already answered. Note this checks for the PROP being absent,
    // not for it being empty: a server-resolved `[]` is a real answer meaning
    // "no provider is configured", and probing anyway would be asking a
    // question that has already been settled.
    if (given) return;
    let cancelled = false;
    fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setProbed(Array.isArray(d.available) ? (d.available as Provider[]) : null);
      })
      .catch(() => {
        // Stays null — unknown, not known-empty.
      });
    return () => {
      cancelled = true;
    };
  }, [given]);

  const available = given ?? probed;
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
