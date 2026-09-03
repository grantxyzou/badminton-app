import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import ThemeToggle from '@/components/ThemeToggle';

/**
 * The public legal pages: privacy, terms, support, account deletion.
 *
 * These are the URLs pasted into App Store Connect and Play Console, and the
 * one place a person can read our privacy policy without signing in. So,
 * unlike `app/design`, there is NO flag gate and they are indexable. They are
 * server components with no client state and no fetch: the store crawlers,
 * a reviewer on a locked-down network, and a member who has deleted the app
 * all need them to render from HTML alone.
 */
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('legal.common');
  return (
    <div style={{ minHeight: '100vh', paddingBottom: 'calc(var(--space-9) + var(--space-5))' }}>
      <ThemeToggle />
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: 'var(--space-4) var(--space-5)',
          background: 'var(--page-bg)',
          borderBottom: '1px solid var(--divider)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        {/* `.bpm-row-link` is a full-width space-between row by design; as a
            header link that pushes the label under the theme toggle. */}
        <Link
          href="/"
          className="bpm-row-link"
          style={{ width: 'auto', justifyContent: 'flex-start', minHeight: 'auto', textDecoration: 'none' }}
        >
          <span className="material-icons icon-sm" aria-hidden="true">arrow_back</span>
          {t('back')}
        </Link>
      </header>
      <main style={{ maxWidth: '640px', margin: '0 auto', padding: 'var(--space-6) var(--space-5)' }}>
        {children}
      </main>
    </div>
  );
}
