import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { APP_NAME } from '@/lib/brand';
import { GUIDES } from '@/lib/helpGuides';

export const metadata: Metadata = { title: `How to use ${APP_NAME}` };

/**
 * "How to use BPM" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §7–§8):
 * every guide, public and indexable like the rest of `/legal`, so a member
 * can read one before signing in and the store listings can link here.
 * A server component with no client state and no network read, as the
 * legal-pages test requires.
 */
export default async function HelpIndexPage() {
  const t = await getTranslations('legal.help');
  return (
    <article>
      <h1 className="bpm-h1">{t('title')}</h1>
      <p className="fs-lg" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-3)' }}>
        {t('intro')}
      </p>
      <ul className="help-list" style={{ marginTop: 'var(--space-6)' }}>
        {GUIDES.map((g) => (
          <li key={g.key}>
            <Link href={`/legal/help/${g.slug}`} className="help-row">
              <span className="help-row__icon" aria-hidden="true"><span className="material-icons">{g.icon}</span></span>
              <span className="help-row__text">
                <span className="help-row__title">{t(`guides.${g.key}.title`)}</span>
                <span className="help-row__sub">{t(`guides.${g.key}.sub`)}</span>
              </span>
              <span className="material-icons help-row__chev" aria-hidden="true">chevron_right</span>
            </Link>
          </li>
        ))}
      </ul>
    </article>
  );
}
