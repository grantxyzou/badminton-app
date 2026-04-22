import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import PreviewBanner from '@/components/PreviewBanner';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm'),
  title: 'BPM Badminton',
  description: 'Sign up for weekly badminton sessions',
  openGraph: {
    title: 'BPM Badminton',
    description: 'Sign up for weekly badminton sessions',
    url: 'https://badminton-app-gzendxb6fzefafgm.canadacentral-01.azurewebsites.net/bpm',
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
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
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
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
