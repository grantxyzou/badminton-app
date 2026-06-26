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
 * No service worker by design (CLAUDE.md: offline posture is "legible-fail").
 * iOS installs fully standalone from this alone; Android supports manual
 * "Add to Home screen" (the automatic install prompt would need a SW + fetch
 * handler, which we deliberately don't ship).
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
