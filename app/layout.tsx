import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import PreviewBanner from '@/components/PreviewBanner';
import HydrationMark from '@/components/HydrationMark';
import { APP_TIME_ZONE } from '@/i18n/request';
import './globals.css';

// Locked type system (design-system bundle v3):
//   Space Grotesk  — display / headlines  (self-hosted variable, wght 300–700)
//   IBM Plex Sans  — body / UI            (self-hosted variable, wght 100–700 + width 85–100, + italic)
//   JetBrains Mono — data (PINs, $, time) (Google Fonts subset)
// Self-hosted via `next/font/local` so first paint never waits on the Google
// Fonts CDN and the app works on restricted networks. Mono stays on Google
// since it's below-the-fold on first load and the subset is tiny.
const spaceGrotesk = localFont({
  src: './fonts/SpaceGrotesk-VariableFont_wght.ttf',
  display: 'swap',
  variable: '--ff-space-grotesk',
  // Preload off: Turbopack dev-mode hashed filenames can desync between the
  // <link rel="preload"> tag and the CSS url() reference after HMR, causing
  // Chrome to flag "preloaded but not used." Metric-matched fallback keeps
  // first-paint stable (zero CLS); the font swaps in on the next tick.
  preload: false,
  weight: '300 700',
});
const ibmPlexSans = localFont({
  src: [
    { path: './fonts/IBMPlexSans-VariableFont_wdth_wght.ttf',        style: 'normal', weight: '100 700' },
    { path: './fonts/IBMPlexSans-Italic-VariableFont_wdth_wght.ttf', style: 'italic', weight: '100 700' },
  ],
  display: 'swap',
  variable: '--ff-ibm-plex',
  // Preload off: `preload: true` forces every src entry (incl. italic) into the
  // <link rel="preload"> head. Italic isn't in the above-the-fold content on
  // any live page, so Chrome warns "preloaded but not used within a few seconds
  // of the window's load event". Dropping preload keeps the FOUT brief (metric-
  // matched fallback = zero CLS) while silencing the warning on production.
  preload: false,
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
  maximumScale: 1,
  userScalable: false,
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
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=add,admin_panel_settings,arrow_back,auto_fix_high,bar_chart,bolt,calendar_today,campaign,celebration,check_circle,chevron_left,chevron_right,close,dark_mode,delete,delete_forever,delete_outline,delete_sweep,download,edit,emoji_events,error,error_outline,event,expand_less,expand_more,format_list_bulleted,format_list_numbered,group,group_add,groups,home,hourglass_empty,hourglass_top,how_to_reg,inventory_2,key,light_mode,local_fire_department,lock,lock_clock,logout,more_vert,paid,payments,person,person_remove,radio_button_unchecked,receipt_long,remove,restore,schedule,school,science,shield,sports_tennis,star,subdirectory_arrow_left,translate,trending_up,verified,visibility,watch_later&display=swap"
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
