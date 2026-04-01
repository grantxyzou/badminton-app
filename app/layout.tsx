import type { Metadata, Viewport } from 'next';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons|Material+Icons+Outlined|Material+Icons+Round"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Badminton court background */}
        <div className="court-bg" aria-hidden="true">
          <div className="aurora-blob-1" />
          <div className="aurora-blob-2" />
          <div className="aurora-blob-3" />
        </div>
        {children}
      </body>
    </html>
  );
}
