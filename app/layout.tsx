import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Badminton Sign-Up',
  description: 'Badminton session sign-up tool',
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
          href="https://fonts.googleapis.com/icon?family=Material+Icons"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Badminton court background */}
        <div className="court-bg" aria-hidden="true">
          <div className="aurora-blob-1" />
          <div className="aurora-blob-2" />
          <div className="aurora-blob-3" />
          <svg
            viewBox="0 0 390 844"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid slice"
          >
            {/* Court lines */}
            <g stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" fill="none">
              {/* Outer boundary */}
              <rect x="68" y="140" width="254" height="564" />
              {/* Singles sidelines */}
              <line x1="89" y1="140" x2="89" y2="704" />
              <line x1="301" y1="140" x2="301" y2="704" />
              {/* Long service lines (doubles) */}
              <line x1="68" y1="172" x2="322" y2="172" />
              <line x1="68" y1="672" x2="322" y2="672" />
              {/* Short service lines */}
              <line x1="68" y1="338" x2="322" y2="338" />
              <line x1="68" y1="506" x2="322" y2="506" />
              {/* Center lines (service boxes) */}
              <line x1="195" y1="172" x2="195" y2="338" />
              <line x1="195" y1="506" x2="195" y2="672" />
            </g>
            {/* Net — dashed, bounded by outer court lines */}
            <line
              x1="68" y1="422" x2="322" y2="422"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="1"
              strokeDasharray="7 5"
            />
          </svg>
        </div>
        {children}
      </body>
    </html>
  );
}
