import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import PreviewBanner from '@/components/PreviewBanner';
import HydrationMark from '@/components/HydrationMark';
import { APP_TIME_ZONE } from '@/i18n/request';
import { APP_NAME, APP_SHORT_NAME } from '@/lib/brand';
import './globals.css';

// Locked type system (design-system bundle v3, subset 2026-05-07):
//   Space Grotesk  — display / headlines  (variable wght 400–700, Latin Ext WOFF2 ~40 KB)
//   IBM Plex Sans  — body / UI            (variable wght 400–700, wdth pinned 100, Latin Ext WOFF2 ~58 KB)
//   JetBrains Mono — data (PINs, $, time) (variable wght 400–600, WOFF2 ~40 KB)
// Subsetting from upstream variable TTFs: see `docs/subset-fonts.md` for the
// pyftsubset / fonttools.varLib.instancer pipeline. We dropped the IBM Plex
// italic font (~150 KB transfer) — `<em>` falls back to algorithmic italic,
// which is indistinguishable for body emphasis. Self-hosted (not Google
// Fonts) so first paint never waits on a third-party CDN.
//
// ALL THREE are `next/font/local`, and that is load-bearing for the BUILD, not
// just for first paint. JetBrains Mono came from `next/font/google` until
// 2026-09-07, which meant `next build` had to reach fonts.googleapis.com or it
// FAILED outright — not a warning, a non-zero exit:
//
//   Error: next/font: Failed to fetch JetBrains Mono from Google Fonts.
//
// A production deploy therefore depended on a third party being up at build
// time, for a font that was already being self-served at runtime (that is what
// next/font/google does — it downloads at build and serves from our origin).
// All risk, no benefit. It also made the build unrunnable offline, which is
// how this was found. Don't reintroduce a `next/font/google` import here.
const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-Subset.woff2',
  display: 'swap',
  variable: '--ff-space-grotesk',
  // Preload off: Turbopack dev-mode hashed filenames can desync between the
  // <link rel="preload"> tag and the CSS url() reference after HMR, causing
  // Chrome to flag "preloaded but not used." Metric-matched fallback keeps
  // first-paint stable (zero CLS); the font swaps in on the next tick.
  preload: false,
  weight: '400 700',
});
const ibmPlexSans = localFont({
  src: './fonts/IBMPlexSans-Subset.woff2',
  display: 'swap',
  variable: '--ff-ibm-plex',
  // Preload off: avoids the "preloaded but not used within a few seconds"
  // Chrome warning. Metric-matched fallback (system-ui at 16/24) keeps
  // CLS at zero during the brief FOUT window before the WOFF2 lands.
  preload: false,
  weight: '400 700',
});
/* Material Symbols, self-hosted for the reason every other face here is: a
   <link> to fonts.googleapis.com in <head> BLOCKS first paint, and it was the
   only one left. `display: 'block'` because these glyphs are LIGATURES — a
   fallback font paints the glyph's NAME ("expand_less") as a word, so blank
   for a moment is the better failure. Rebuild with
   `node scripts/fetch-icon-font.mjs` after editing `lib/iconNames.ts`. */
const materialSymbols = localFont({
  src: './fonts/MaterialSymbolsRounded-Subset.woff2',
  display: 'block',
  variable: '--ff-material-symbols',
  preload: false,
  weight: '400',
});
const jetbrainsMono = localFont({
  src: './fonts/JetBrainsMono-Subset.woff2',
  display: 'swap',
  variable: '--ff-jetbrains',
  preload: false, // mono is below-the-fold on first load
  weight: '400 600',
});

/**
 * Canonical URL for SEO + social-share metadata. Pulls from
 * `NEXT_PUBLIC_BASE_URL` so a custom-domain swap is one Azure App Setting
 * change + redeploy — no code edit. Fallback retains the current bpm-stable
 * azurewebsites URL so dev and any environment without the var set produces
 * sensible output.
 */
const CANONICAL_URL =
  process.env.NEXT_PUBLIC_BASE_URL ??
  'https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm';

// basePath prefix for icon URLs. Next prefixes the auto-injected manifest link
// but NOT metadata.icons string values, so prefix them here (mirrors the
// client-side `BASE` convention used across the app).
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_URL),
  // Which build answered? The deploy smoke check has no other way to tell,
  // and without it the whole check is a placebo: `webapps-deploy` returns
  // before the swap finishes, so four green assertions against the PREVIOUS
  // (healthy) instance look exactly like a successful deploy. The SHA was
  // already baked in at build time and, until now, read only by
  // PreviewBanner — which production deliberately never renders.
  //
  // Not a secret: it names a commit in a public repo.
  other: { 'bpm-build': process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev' },
  title: APP_NAME,
  description: 'Sign up for weekly badminton sessions',
  // PWA: installable standalone home-screen app. The manifest link is
  // auto-injected from app/manifest.ts (basePath-prefixed by Next); these
  // fields add the iOS home-screen behavior + icons (paths prefixed by hand).
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_SHORT_NAME,
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: `${BASE}/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { url: `${BASE}/icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: `${BASE}/icons/apple-touch-icon-180.png`, sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: APP_NAME,
    description: 'Sign up for weekly badminton sessions',
    url: CANONICAL_URL,
    siteName: APP_NAME,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: 'Sign up for weekly badminton sessions',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Standalone status-bar / Android toolbar tint — matches the dark brand bg
  // and the cold-start splash (var(--page-bg)).
  // Stays the un-tinted base — see the note in app/manifest.ts. A single
  // static value cannot track five per-tab fields.
  themeColor: '#100F0F',
  // Pinch / double-tap / input-focus zoom disabled by product decision — the
  // accidental-zoom jank on the saved-to-homescreen iOS web app outweighed the
  // benefit here. NOTE: this is a deliberate WCAG 1.4.4 tradeoff (Lighthouse
  // a11y will flag it). `touch-action: manipulation` in globals.css removes the
  // double-tap zoom + 300ms tap delay; the scale cap stops pinch + input zoom.
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-top) to be non-zero: without `cover`
  // WKWebView reports 0 and the native shell's status bar overlaps the top
  // bar. Correct for the installed PWA too (black-translucent status bar).
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    /* This used to carry `data-visual="field"`, stamped on the SERVER from
       NEXT_PUBLIC_FLAG_VISUAL_FIELDS so the page's ground colour resolved
       before the LCP frame rather than in a useEffect like `data-tab`. That
       flag RETIRED on 2026-09-10 and the fields are now unconditional, so the
       attribute is gone. The field rules in globals.css kept an `html:root`
       prefix in its place — that is a SPECIFICITY device, not a leftover;
       globals.css explains why above the field-card padding rule. */
    <html
      lang={locale}
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable} ${materialSymbols.variable}`}
    >
      <head>
        {/* iOS standalone launch (no Safari chrome). Next emits the modern
            `mobile-web-app-capable` from metadata.appleWebApp, but older iOS
            still reads the apple-prefixed name — declare it explicitly so the
            home-screen app opens fullscreen on every iOS version. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {/* HydrationMark sets html[data-hydrated="true"] on mount so the splash
            hides instantly on every route (not just /). Lives in root layout
            so non-index routes like /design don't fall through to the 5.4s
            CSS failsafe. */}
        <HydrationMark />
        <PreviewBanner />
        {/* Cold-start splash — hidden by CSS once HydrationMark sets data-hydrated */}
        <div className="splash" aria-hidden="true">
          <div className="splash-shuttle ring-spinner" />
          <h1 className="splash-title">{APP_NAME}</h1>
          <p className="splash-tagline">Weekly sessions</p>
        </div>
        {/* Badminton court background */}
        <div className="court-bg" aria-hidden="true">
          <div className="aurora-blob-1" />
          <div className="aurora-blob-2" />
          <div className="aurora-blob-3" />
        </div>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={APP_TIME_ZONE}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
