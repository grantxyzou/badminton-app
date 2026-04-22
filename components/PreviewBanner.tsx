'use client';

import { isPreviewEnv } from '@/lib/flags';

const BANNER_HEIGHT = 28;
const REPORT_EMAIL = 'xyzou2012@gmail.com';

export default function PreviewBanner() {
  if (!isPreviewEnv()) return null;

  const sha = (process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev').slice(0, 7);

  function handleReportClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    const subject = `bpm-next bug report · ${sha}`;
    const body = [
      `URL: ${window.location.href}`,
      `SHA: ${sha}`,
      `UA: ${navigator.userAgent}`,
      '',
      'What went wrong:',
      '',
    ].join('\n');
    window.location.href = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  }

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          padding: '6px 12px',
          textAlign: 'center',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          background: 'linear-gradient(90deg, #f59e0b, #f97316)',
          color: '#111',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        }}
      >
        preview bpm vnext · {sha} not the stable site ·{' '}
        <a
          href={`mailto:${REPORT_EMAIL}`}
          onClick={handleReportClick}
          style={{ color: '#111', textDecoration: 'underline' }}
        >
          report a bug
        </a>
      </div>
      <div style={{ height: BANNER_HEIGHT }} aria-hidden="true" />
    </>
  );
}
