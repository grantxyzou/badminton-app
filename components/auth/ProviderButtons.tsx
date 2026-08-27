'use client';

import { useEffect, useState } from 'react';
import { beginHandoff } from '@/lib/handoffClient';
import { markExternalExcursion } from '@/lib/excursion';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import GoogleMark from './GoogleMark';

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
  /* The handoff ref for this mount. Minted up front rather than in the click
     handler: these are plain <a> elements, and a tap must not wait on an async
     digest before navigating. `null` degrades to the cookie flow, which is the
     right answer for every browser that keeps one jar. */
  const [handoffRef, setHandoffRef] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void beginHandoff().then((ref) => {
      if (!cancelled) setHandoffRef(ref);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

        // Google's button is Google's, down to the surface colours — see
        // `.btn-google` in globals.css. Apple is deliberately still on the
        // generic style: Sign in with Apple has its own mandatory button spec
        // (their mark, their black/white/outline set, SF), and shipping it
        // dressed as a Google button would breach it. It needs the same
        // treatment before the Apple provider is ever switched on.
        const branded = p === 'google';
        return (
          <a
            key={p}
            href={
              online
                ? `${BASE}/api/auth/${p}/start${handoffRef ? `?hr=${handoffRef}` : ''}`
                : undefined
            }
            /* iOS evicts the PWA while a system browser is in front, so the
               return looks like a cold start and lands on Home. Same hand-off
               marker ReceiptSheet uses — see lib/excursion.ts. */
            onClick={() => markExternalExcursion()}
            aria-disabled={!online}
            className={branded ? 'cc-btn btn-google' : 'cc-btn cc-btn-secondary'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textDecoration: 'none',
              ...(branded ? {} : { width: '100%', gap: 'var(--space-3)' }),
              // Matches .cc-btn:disabled rather than inventing a new disabled
              // look — the design system's rule for a not-currently-actionable
              // control.
              ...(online ? {} : { opacity: 0.5, pointerEvents: 'none' as const }),
            }}
          >
            {branded && <GoogleMark />}
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
