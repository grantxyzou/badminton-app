import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — makes BPM installable ("Add to Home Screen") and launch
 * standalone (fullscreen, no browser chrome) on iOS and Android.
 *
 * basePath gotcha: Next applies `basePath` to the injected `<link rel="manifest">`
 * URL, but NOT to the string values inside the manifest. So `start_url`, `scope`,
 * and every icon `src` must be `/bpm`-prefixed by hand — mirror the client-side
 * `BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''` convention (see HomeShell).
 *
 * The only service worker we ship is push-only (`public/sw.js`) and has no
 * `fetch` handler, so the "legible-fail" offline posture is unchanged — nothing
 * is ever served from cache (CLAUDE.md: Push Notifications). It is registered
 * lazily, only when a user opts into notifications.
 *
 * iOS installs fully standalone from this manifest alone; Android supports
 * manual "Add to Home screen". The automatic install prompt still requires a
 * SW *with a fetch handler*, which we deliberately don't ship — so that prompt
 * remains unavailable, by choice.
 *
 * `display: 'standalone'` here is also load-bearing for notifications: iOS
 * 16.4+ only permits Web Push from a home-screen-installed PWA.
 */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BPM Badminton',
    short_name: 'BPM',
    description: 'Sign up for weekly badminton sessions',
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#100F0F',
    theme_color: '#100F0F',
    icons: [
      { src: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${BASE}/icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
