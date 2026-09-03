import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

export type LegalDocKey = 'privacy' | 'terms' | 'support' | 'deleteAccount';

interface Section {
  h: string;
  p: string[];
}

/**
 * One legal document: a title, a "last updated" line, and a list of
 * heading + paragraphs sections read with `t.raw` from `legal.<doc>.sections`.
 *
 * Long legal copy as a sections ARRAY keeps `messages/*.json` sane — one key
 * per paragraph would be forty keys per document, in two locales. The cost is
 * that `scripts/check-i18n-keys.mjs` cannot see `t.raw`, so the shape of the
 * array is pinned by `__tests__/legal-pages.test.ts` instead.
 *
 * `children` renders AFTER the sections — support and delete-account use it
 * for the parts that aren't prose (an email address from env, a link into the
 * app).
 */
export default async function LegalDoc({ doc, children }: { doc: LegalDocKey; children?: ReactNode }) {
  const t = await getTranslations(`legal.${doc}`);
  const tc = await getTranslations('legal.common');
  const sections = t.raw('sections') as Section[];

  return (
    <article>
      <h1 className="bpm-h1">{t('title')}</h1>
      <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-05)' }}>
        {tc('updated', { date: t('updated') })}
      </p>
      {sections.map((s) => (
        <section key={s.h} style={{ marginTop: 'var(--space-7)' }}>
          <h2 className="bpm-h3">{s.h}</h2>
          {s.p.map((para, i) => (
            <p
              key={i}
              className="fs-md"
              style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-3)' }}
            >
              {para}
            </p>
          ))}
        </section>
      ))}
      {children}
    </article>
  );
}

/** A bulleted list of strings from `t.raw`, in the same body style as a paragraph. */
export function LegalList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-6)', listStyle: 'disc' }}>
      {items.map((s, i) => (
        <li
          key={i}
          className="fs-md"
          style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-2)' }}
        >
          {s}
        </li>
      ))}
    </ul>
  );
}
