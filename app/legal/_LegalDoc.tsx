import type { ReactNode } from 'react';
import { rawList } from '@/lib/rawList';
import { getTranslations } from 'next-intl/server';

export type LegalDocKey = 'privacy' | 'terms' | 'support' | 'deleteAccount';

interface Section {
  h: string;
  /** Paragraphs. A run of lines starting with `• ` renders as one bulleted
   *  list — a marker rather than a second key, because the message JSON is
   *  typed as one tree and a section with `items` but no `p` is a different
   *  shape from one with `p` but no `items`. */
  p: string[];
}

const BULLET = '• ';

/** Paragraphs, with each run of bullet lines gathered into one list. */
function blocks(lines: string[]): Array<{ kind: 'p'; text: string } | { kind: 'list'; items: string[] }> {
  const out: Array<{ kind: 'p'; text: string } | { kind: 'list'; items: string[] }> = [];
  for (const line of lines) {
    if (line.startsWith(BULLET)) {
      const last = out[out.length - 1];
      if (last?.kind === 'list') last.items.push(line.slice(BULLET.length));
      else out.push({ kind: 'list', items: [line.slice(BULLET.length)] });
    } else out.push({ kind: 'p', text: line });
  }
  return out;
}

/**
 * `**bold**` spans, and nothing else. Legal copy leads each list item with a
 * bold label; this is the whole of the markup it needs, so there is no raw-HTML
 * path for a translation to smuggle anything through.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
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
  const sections = rawList<Section>(t.raw('sections'));

  return (
    <article>
      <h1 className="bpm-h1">{t('title')}</h1>
      <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-05)' }}>
        {tc('updated', { date: t('updated') })}
      </p>
      {sections.map((s) => (
        <section key={s.h} style={{ marginTop: 'var(--space-7)' }}>
          <h2 className="bpm-h3">{s.h}</h2>
          {blocks(rawList<string>(s.p)).map((b, i) => b.kind === 'list' ? <LegalList key={i} items={b.items} /> : (
            <p
              key={i}
              className="fs-md"
              style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-3)' }}
            >
              {inline(b.text)}
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
          {inline(s)}
        </li>
      ))}
    </ul>
  );
}
