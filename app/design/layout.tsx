import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEnv, isFlagOn } from '@/lib/flags';
import ThemeToggle from '@/components/ThemeToggle';
// Do NOT import @/docs/design-system/colors_and_type.css here — its :root
// block re-asserts the dark-mode tokens and would clobber globals.css's
// [data-theme="light"] overrides in the cascade (same specificity, later
// wins). globals.css is already the single source of truth for tokens in
// this app; the docs/* CSS is kept as the pristine bundle-reference copy.
import { SUBPAGES } from './_nav';

export const metadata: Metadata = {
  title: 'BPM Design System — Preview',
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  const allowed = getEnv() === 'dev' || isFlagOn('NEXT_PUBLIC_FLAG_DESIGN_PREVIEW');
  if (!allowed) notFound();

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '4rem' }}>
      <ThemeToggle />
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: '0.75rem 1rem',
          background: 'var(--page-bg)',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          gap: '0.5rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Link
          href="/design"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            alignSelf: 'center',
          }}
        >
          bpm/design
        </Link>
        {SUBPAGES.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              textDecoration: 'none',
              padding: '0.35rem 0.75rem',
              borderRadius: 'var(--radius-pill, 100px)',
              border: '1px solid var(--glass-border)',
              background: 'var(--glass-bg)',
              whiteSpace: 'nowrap',
            }}
          >
            {p.label}
          </Link>
        ))}
      </header>
      {children}
    </div>
  );
}
