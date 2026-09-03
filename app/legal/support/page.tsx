import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import LegalDoc from '../_LegalDoc';

export const metadata: Metadata = { title: 'Support — BPM Badminton' };

export default async function SupportPage() {
  const t = await getTranslations('legal.support');
  // Server-only env, read at request time: changing the address is an App
  // Setting, not a rebuild. Unset → the line is omitted, never a placeholder.
  const email = process.env.SUPPORT_EMAIL?.trim() || null;

  return (
    <LegalDoc doc="support">
      {email && (
        <section style={{ marginTop: 'var(--space-7)' }}>
          <p className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('emailLabel')}</p>
          <a href={`mailto:${email}`} className="bpm-row-link" style={{ marginTop: 'var(--space-2)' }}>
            {email}
          </a>
        </section>
      )}
      <nav
        aria-label="Related"
        style={{ marginTop: 'var(--space-8)', display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}
      >
        <Link href="/legal/delete-account" className="bpm-row-link">{t('deleteLink')}</Link>
        <Link href="/legal/privacy" className="bpm-row-link">{t('privacyLink')}</Link>
      </nav>
    </LegalDoc>
  );
}
