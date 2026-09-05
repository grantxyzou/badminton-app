'use client';

import { useEffect, useState } from 'react';
import { mintHandoff, stageHandoff } from '@/lib/handoffClient';
import { markExternalExcursion } from '@/lib/excursion';
import { isNative, hasNativePlugin } from '@/lib/native';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import GoogleMark from './GoogleMark';

/**
 * The native shell cannot navigate its WebView to the provider: Google answers
 * `disallowed_useragent` inside an embedded WebView, and Apple's form_post
 * would land in a view with no way home. So the flow runs in the SYSTEM
 * browser sheet (SFSafariViewController / Custom Tabs) — which is a separate
 * cookie jar, the exact split `lib/authHandoff.ts` already bridges. `native=1`
 * makes the landing page render a "back to the app" link.
 */
async function openInSystemBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url, presentationStyle: 'popover' });
}

/**
 * Why this can fail, and why the two causes need different words.
 *
 * The shell loads the LIVE web bundle, so BOTH halves of the line above can
 * be older or newer than the phone:
 *  - the `import()` fetches one of OUR chunks, which a deploy has just
 *    replaced — a WebView left open across a deploy 404s. Reloading fixes it.
 *  - `Browser.open` reaches the BINARY, which is as old as the last store
 *    release. If that build predates the plugin, no reload ever helps; only
 *    an app update does.
 *
 * Telling someone to visit the App Store when a reload would have done is a
 * dead end an hour long, so the remedy is chosen from the failure, not
 * guessed. `UNIMPLEMENTED` is Capacitor's code for "this binary has no such
 * plugin" (@capacitor/core's CapacitorException).
 */
function isPluginMissingError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 'UNIMPLEMENTED' || /unimplemented|not implemented/i.test(String(e?.message ?? ''));
}

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
  const [handoff, setHandoff] = useState<{ id: string; ref: string } | null>(null);
  /**
   * `false` until proven otherwise, and never derived during render: this is a
   * client component that server-renders, and `hasNativePlugin` reads a global
   * injected only in the shell, so resolving it inline would be a hydration
   * mismatch. Defaulting to "present" is also the safe direction — an unknown
   * answer must not disable a working button (see `hasNativePlugin`'s
   * tri-state contract).
   */
  const [pluginMissing, setPluginMissing] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  useEffect(() => {
    setPluginMissing(hasNativePlugin('Browser') === false);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void mintHandoff().then((pair) => {
      if (!cancelled) setHandoff(pair);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const handoffRef = handoff?.ref ?? null;

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
        const startHref = `${BASE}/api/auth/${p}/start${handoffRef ? `?hr=${handoffRef}` : ''}`;
        const className = branded ? 'cc-btn btn-google' : 'cc-btn cc-btn-secondary';
        const style = {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          ...(branded ? {} : { width: '100%', gap: 'var(--space-3)' }),
          // Matches .cc-btn:disabled rather than inventing a new disabled
          // look — the design system's rule for a not-currently-actionable
          // control.
          ...(online ? {} : { opacity: 0.5, pointerEvents: 'none' as const }),
        };

        if (isNative()) {
          // A button, not a link: the navigation happens in the system
          // browser, and a same-document <a> would take the WebView there.
          // The handoff is REQUIRED here (no ref = no way to collect the
          // session), so the button waits for the mint rather than degrading.
          return (
            <button
              key={p}
              type="button"
              disabled={!online || !handoff || pluginMissing}
              onClick={() => {
                if (!handoff) return;
                // Both of these must stay SYNCHRONOUS and ahead of the open:
                // the excursion marker is what survives iOS evicting the PWA
                // while the sheet is up (CLAUDE.md), and it cannot be moved
                // after an await. If the open then fails, the staged handoff
                // simply expires and a stale excursion marker only restores
                // the last tab for three minutes — both harmless.
                stageHandoff(handoff.id);
                markExternalExcursion();
                void openInSystemBrowser(`${window.location.origin}${startHref}&native=1`).catch(
                  (err: unknown) => {
                    console.error('[ProviderButtons] system browser failed:', err);
                    if (isPluginMissingError(err)) setPluginMissing(true);
                    else setOpenFailed(true);
                  },
                );
              }}
              className={className}
              style={style}
            >
              {branded && <GoogleMark />}
              {label}
            </button>
          );
        }

        return (
          <a
            key={p}
            href={online ? startHref : undefined}
            /* iOS evicts the PWA while a system browser is in front, so the
               return looks like a cold start and lands on Home. Same hand-off
               marker ReceiptSheet uses — see lib/excursion.ts. */
            onClick={() => {
              /* Commit the id HERE, not at mint time. This component remounts
                 when the person returns from the excursion, and writing on
                 mount would overwrite the handoff they came back to collect. */
              if (handoff) stageHandoff(handoff.id);
              markExternalExcursion();
            }}
            aria-disabled={!online}
            className={className}
            style={style}
          >
            {branded && <GoogleMark />}
            {label}
          </a>
        );
      })}
      {!online && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('offline')}</p>
      )}
      {online && pluginMissing && (
        <p className="field-error" role="alert">
          {t('appOutdated')}
        </p>
      )}
      {online && !pluginMissing && openFailed && (
        <p className="field-error" role="alert">
          {t('openFailed')}
        </p>
      )}
    </div>
  );
}
