'use client';

import { isPreviewEnv } from '@/lib/flags';

const BUG_REPORT_URL = 'mailto:xyzou2012@gmail.com?subject=bpm-next%20bug%20report';

export default function PreviewBanner() {
  if (!isPreviewEnv()) return null;

  const sha = (process.env.NEXT_PUBLIC_GIT_SHA ?? 'dev').slice(0, 7);

  return (
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
        href={BUG_REPORT_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: '#111', textDecoration: 'underline' }}
      >
        report a bug
      </a>
    </div>
  );
}
