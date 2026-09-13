'use client';

/* eslint-disable no-restricted-syntax --
   Literal colours and sizes are REQUIRED here, not laziness. This component
   replaces the root layout, so `globals.css` and the font vars may not have
   loaded — a `var(--text-primary)` would resolve to nothing and render
   invisible text on the one screen whose entire job is to be readable. Same
   sanctioned-exemption shape as `app/opengraph-image.tsx`, where Satori cannot
   resolve custom properties either. */

import { useEffect } from 'react';
import { APP_NAME } from '@/lib/brand';

/**
 * The LAST boundary. Catches what `app/error.tsx` structurally cannot.
 *
 * `error.tsx` renders INSIDE the root layout, so it can only catch throws from
 * the page tree beneath it. A throw in `app/layout.tsx` itself escapes — and
 * that layout does the riskiest work in the app on every single request:
 * `getLocale()` and `getMessages()`, which resolve through `i18n/request.ts`
 * into `cookies()`, `headers()`, a dynamic `await import()` of a locale JSON,
 * and a recursive `deepMerge`. A malformed messages file or an unexpected
 * shape there takes out the whole document.
 *
 * That is the exact failure `app/error.tsx`'s own docblock says it exists to
 * prevent — "inside the Capacitor shell the SAME white screen reads as 'this
 * app is broken', and that is the review someone leaves" — and it was the one
 * path not covered by it.
 *
 * Because this replaces the root layout, it must ship its own `<html>` and
 * `<body>`, and it CANNOT rely on anything the layout provides: no fonts, no
 * `globals.css` tokens, no next-intl. Every style here is a literal on
 * purpose. A boundary that depends on the thing that just failed is a white
 * screen with extra steps.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The only telemetry available at this level. `console.error` in a
    // WebView goes nowhere useful, but it is reachable over Safari Web
    // Inspector when someone is actually debugging a device.
    console.error('global-error boundary caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          // Literals, not tokens: globals.css may not have loaded.
          background: '#100F0F',
          color: '#F5F5F4',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '340px', textAlign: 'center' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>
            {APP_NAME} didn&apos;t load
          </h1>
          {/* Say what to do, not what went wrong — nobody can act on a stack
              trace, and "something went wrong" is the phrase people have
              learned means nobody is coming. */}
          <p
            style={{
              fontSize: '14px',
              lineHeight: 1.5,
              color: 'rgba(245,245,244,0.7)',
              margin: '0 0 20px',
            }}
          >
            Something went wrong starting the app. Reopening it usually fixes
            this. If it keeps happening, let Grant know.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              width: '100%',
              minHeight: '44px',
              borderRadius: '16px',
              border: 'none',
              background: '#22c55e',
              color: '#0A0A0A',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest && (
            /* The one thing that makes a report actionable. Small and muted:
               it is for Grant to relay, not for the player to interpret. */
            <p
              style={{
                fontSize: '11px',
                color: 'rgba(245,245,244,0.35)',
                margin: '16px 0 0',
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
