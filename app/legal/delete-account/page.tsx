import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalList } from '../_LegalDoc';

export const metadata: Metadata = { title: 'Delete your account — BPM Badminton' };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The web-reachable account-deletion page Google Play requires (in-app alone
 * does not satisfy the policy) and the one Apple reviewers look for.
 *
 * It must work SIGNED OUT, so it is static prose plus one link into the app.
 * The link carries `intent=delete`: HomeShell lands on Profile and, once an
 * identity resolves (signing in if needed), opens DeleteAccountSheet — the
 * same sheet, the same `DELETE /api/members/me`, no second deletion path to
 * keep in step. A plain `<a>` rather than `<Link>` so the shell mounts fresh
 * and its param-reading effect runs.
 */
export default async function DeleteAccountPage() {
  const t = await getTranslations('legal.deleteAccount');
  const tc = await getTranslations('legal.common');
  const email = process.env.SUPPORT_EMAIL?.trim() || null;
  const steps = t.raw('steps') as string[];
  const what = t.raw('what') as string[];
  const keeps = t.raw('keeps') as string[];

  const body = { color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)' } as const;

  return (
    <article>
      <h1 className="bpm-h1">{t('title')}</h1>
      <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-05)' }}>
        {tc('updated', { date: t('updated') })}
      </p>
      <p className="fs-md" style={{ ...body, marginTop: 'var(--space-5)' }}>{t('intro')}</p>

      <section style={{ marginTop: 'var(--space-7)' }}>
        <h2 className="bpm-h3">{t('stepsTitle')}</h2>
        <ol style={{ margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-6)' }}>
          {steps.map((s, i) => (
            <li key={i} className="fs-md" style={{ ...body, marginTop: 'var(--space-2)' }}>{s}</li>
          ))}
        </ol>
        <a
          href={`${BASE}/?tab=profile&intent=delete`}
          className="btn-primary"
          style={{ display: 'inline-block', marginTop: 'var(--space-5)', textDecoration: 'none' }}
        >
          {t('cta')}
        </a>
      </section>

      <section style={{ marginTop: 'var(--space-7)' }}>
        <h2 className="bpm-h3">{t('whatTitle')}</h2>
        <LegalList items={what} />
      </section>

      <section style={{ marginTop: 'var(--space-7)' }}>
        <h2 className="bpm-h3">{t('keepsTitle')}</h2>
        <LegalList items={keeps} />
      </section>

      <section style={{ marginTop: 'var(--space-7)' }}>
        <h2 className="bpm-h3">{t('noAppTitle')}</h2>
        <p className="fs-md" style={{ ...body, marginTop: 'var(--space-3)' }}>{t('noApp')}</p>
        {email && (
          <p className="fs-md" style={{ ...body, marginTop: 'var(--space-3)' }}>
            {t('emailLabel')}{' '}
            <a href={`mailto:${email}`} className="bpm-row-link">{email}</a>
          </p>
        )}
      </section>
    </article>
  );
}
