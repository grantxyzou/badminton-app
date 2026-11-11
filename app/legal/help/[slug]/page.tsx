import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { APP_NAME } from '@/lib/brand';
import { rawList } from '@/lib/rawList';
import { guideByKey, guideBySlug, helpImageSrc } from '@/lib/helpGuides';
import { HELP_IMAGES } from '@/lib/helpImages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Step {
  t: string;
  b: string;
  /** A screenshot under the step: `public/help/<locale>/<img>.webp`. */
  img?: string;
  alt?: string;
  caption?: string;
}

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ helpful?: string }> };

export async function generateMetadata({ params }: Pick<Params, 'params'>): Promise<Metadata> {
  const guide = guideBySlug((await params).slug);
  if (!guide) return { title: APP_NAME };
  const t = await getTranslations('legal.help');
  return { title: `${t(`guides.${guide.key}.title`)} — ${APP_NAME}` };
}

/**
 * One guide (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §8): a
 * title and intro, numbered steps with a screenshot under the step it shows,
 * a tip, "Was this helpful?", and related guides.
 *
 * Server-only, like every `/legal` page: it must render from HTML alone. So
 * "Was this helpful?" is a plain form POST to `/api/help/feedback`, which
 * records the answer (signed in) and sends the reader back here with
 * `?helpful=`, where the thanks replaces the question. No script, no fetch.
 */
export default async function GuidePage({ params, searchParams }: Params) {
  const guide = guideBySlug((await params).slug);
  if (!guide) notFound();
  const { helpful } = await searchParams;
  const t = await getTranslations('legal.help');
  const locale = await getLocale();
  const k = `guides.${guide.key}` as const;
  const steps = rawList<Step>(t.raw(`${k}.steps`));
  const related = rawList<string>(t.raw(`${k}.related`)).map(guideByKey).filter((g) => g !== undefined);
  const sizes = HELP_IMAGES[locale] ?? HELP_IMAGES.en ?? {};

  return (
    <article>
      <Link href="/legal/help" className="help-crumb">{t('breadcrumb')}</Link>
      <h1 className="bpm-h1" style={{ marginTop: 'var(--space-2)' }}>{t(`${k}.title`)}</h1>
      <p className="fs-lg" style={{ color: 'var(--text-secondary)', lineHeight: 'var(--lh-normal)', marginTop: 'var(--space-3)' }}>
        {t(`${k}.intro`)}
      </p>
      <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
        {t('minRead', { minutes: t(`${k}.minutes`) })}
      </p>

      <h2 className="help-eyebrow">{t('stepsLabel')}</h2>
      <ol className="help-steps">
        {steps.map((s, i) => {
          const size = s.img ? sizes[s.img] : undefined;
          return (
            <li key={i} className="help-step">
              <span className="help-step__num" aria-hidden="true">{i + 1}</span>
              <div className="help-step__body">
                <h3 className="help-step__title">{s.t}</h3>
                <p className="help-step__text">{s.b}</p>
                {s.img && size && (
                  <figure className="help-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a static file under public/, sized; no loader needed */}
                    <img src={helpImageSrc(locale, s.img)} alt={s.alt ?? ''} width={size.w} height={size.h} loading="lazy" decoding="async" />
                    {s.caption && <figcaption>{s.caption}</figcaption>}
                  </figure>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <aside className="help-tip">
        <span className="material-icons" aria-hidden="true">bolt</span>
        <p>
          <strong>{t(`${k}.tipLead`)}</strong> {t(`${k}.tip`)}
        </p>
      </aside>

      <section id="helpful" className="help-helpful" aria-live="polite">
        {helpful === 'yes' || helpful === 'no' ? (
          <p className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('thanks')}</p>
        ) : (
          <form method="post" action={`${BASE}/api/help/feedback`} className="help-helpful__form">
            <input type="hidden" name="guide" value={guide.slug} />
            <span className="fs-md" style={{ color: 'var(--text-primary)' }}>{t('helpfulQ')}</span>
            <span className="help-helpful__buttons">
              <button type="submit" name="answer" value="yes" className="help-pill">{t('yes')}</button>
              <button type="submit" name="answer" value="no" className="help-pill">{t('no')}</button>
            </span>
          </form>
        )}
      </section>

      {related.length > 0 && (
        <>
          <h2 className="help-eyebrow">{t('relatedTitle')}</h2>
          <ul className="help-list">
            {related.map((g) => (
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
        </>
      )}
      <p style={{ marginTop: 'var(--space-7)' }}>
        <Link href="/legal/help" className="link-quiet link-quiet--flush">{t('allGuides')}</Link>
      </p>
    </article>
  );
}
