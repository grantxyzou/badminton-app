import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import PreviewBanner from '@/components/PreviewBanner';
import HydrationMark from '@/components/HydrationMark';
import { APP_TIME_ZONE } from '@/i18n/request';
import './globals.css';

// Locked type system (design-system bundle v3, subset 2026-05-07):
//   Space Grotesk  — display / headlines  (variable wght 400–700, Latin Ext WOFF2 ~40 KB)
//   IBM Plex Sans  — body / UI            (variable wght 400–700, wdth pinned 100, Latin Ext WOFF2 ~58 KB)
//   JetBrains Mono — data (PINs, $, time) (Google Fonts subset)
// Subsetting from upstream variable TTFs: see `docs/subset-fonts.md` for the
// pyftsubset / fonttools.varLib.instancer pipeline. We dropped the IBM Plex
// italic font (~150 KB transfer) — `<em>` falls back to algorithmic italic,
// which is indistinguishable for body emphasis. Self-hosted (not Google
// Fonts) so first paint never waits on a third-party CDN.
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
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--ff-jetbrains',
  preload: false, // mono is below-the-fold on first load
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

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_URL),
  title: 'BPM Badminton',
  description: 'Sign up for weekly badminton sessions',
  openGraph: {
    title: 'BPM Badminton',
    description: 'Sign up for weekly badminton sessions',
    url: CANONICAL_URL,
    siteName: 'BPM Badminton',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BPM Badminton',
    description: 'Sign up for weekly badminton sessions',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Allow user pinch-zoom — disabling it is a WCAG 1.4.4 violation and was
  // flagged by Lighthouse a11y. Low-vision users rely on zoom; the tradeoff
  // (occasional accidental zoom on form inputs) is worth the access.
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Material Symbols Rounded — subsetted to the ~35 glyphs actually used.
            Replaces the old full Material Icons webfont (~100 KB → ~15–20 KB). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=add,add_shopping_cart,admin_panel_settings,arrow_back,arrow_forward,article_person,auto_fix_high,bar_chart,bolt,calendar_today,campaign,celebration,check_circle,chevron_left,chevron_right,close,dark_mode,delete,delete_forever,delete_outline,delete_sweep,download,edit,emoji_events,error,error_outline,event,expand_less,expand_more,format_list_bulleted,format_list_numbered,group,group_add,groups,help_outline,home,hourglass_empty,hourglass_top,how_to_reg,image,inventory_2,key,light_mode,local_fire_department,lock,lock_clock,logout,more_vert,paid,payments,person,person_add,person_remove,radio_button_unchecked,receipt_long,remove,request_quote,restore,schedule,school,science,search,shield,sports_tennis,star,subdirectory_arrow_left,translate,trending_up,verified,visibility,warning,watch_later&display=swap"
          rel="stylesheet"
        />
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
          <div className="splash-shuttle" />
          <h1 className="splash-title">BPM Badminton</h1>
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
