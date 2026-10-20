'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import MemberAvatar from '@/components/primitives/MemberAvatar';
import { useActiveName } from '@/lib/useActiveName';
import { useSkillText } from '@/lib/useSkillText';
import { sharedRead } from '@/lib/sharedRead';
import { SKILLS } from '@/lib/assessment';
import { KUDOS_TAGS, TAG_ICON, type KudosCount, type KudosMonth } from '@/lib/kudos';
import { useStatsTakeover } from './statsTakeover';

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; kudos: KudosCount[]; months: KudosMonth[]; people: number }
  | { kind: 'error' }
  | { kind: 'needsAuth' };

/**
 * "Your kudos" — every kudos the member has received, as a page in the Play
 * register (Grant, Stats canvas, 2026-10-19). The tally on top, then each
 * month: the signed notes with their dates, and the bare tags as counts.
 *
 * Reads the same `GET /api/kudos` as `KudosReceivedCard`, whose `months`
 * field already drops what a bare tag must not carry: no date, no order, no
 * name. Nothing here re-derives that rule.
 */
export default function KudosAllPage({ onBack }: { onBack: () => void }) {
  const t = useTranslations('stats.kudos');
  const tStats = useTranslations('stats');
  const locale = useLocale();
  const skillText = useSkillText();
  const { name: activeName } = useActiveName();
  const [state, setState] = useState<Load>({ kind: 'loading' });
  useStatsTakeover(true);

  const load = useCallback(() => {
    if (!activeName) return;
    setState({ kind: 'loading' });
    sharedRead<{ kudos?: unknown; months?: unknown; people?: unknown }>(`/api/kudos?name=${encodeURIComponent(activeName)}`)
      .then((d) => {
        if (!Array.isArray(d?.kudos)) { setState({ kind: 'error' }); return; }
        setState({
          kind: 'ok',
          kudos: d.kudos as KudosCount[],
          months: Array.isArray(d.months) ? (d.months as KudosMonth[]) : [],
          people: typeof d.people === 'number' ? d.people : 0,
        });
      })
      // A 403 is this device not owning the name, not a failure.
      .catch((e: Error) => setState(e?.message === '403' ? { kind: 'needsAuth' } : { kind: 'error' }));
  }, [activeName]);

  useEffect(() => { load(); }, [load]);

  const monthName = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    const sameYear = y === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, { month: 'long', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, 15)));
  };

  let body: React.ReactNode;
  if (!activeName || state.kind === 'needsAuth') {
    body = <div className="glass-card p-5"><EmptyState>{t('allLocked')}</EmptyState></div>;
  } else if (state.kind === 'loading') {
    body = <CardSkeleton height={240} />;
  } else if (state.kind === 'error') {
    body = (
      <div className="glass-card p-5">
        <ErrorState message={t('error')} action={<button type="button" className="cc-btn cc-btn-ghost" onClick={load}>{tStats('retry')}</button>} />
      </div>
    );
  } else if (state.kudos.length === 0) {
    body = <div className="glass-card p-5"><EmptyState>{t('allEmpty')}</EmptyState></div>;
  } else {
    const total = state.kudos.reduce((n, k) => n + k.count, 0);
    const top = Math.max(...state.kudos.map((k) => k.count));
    const tally = KUDOS_TAGS.map((tag) => ({ tag, count: state.kudos.find((k) => k.tag === tag)?.count ?? 0 }))
      .filter((k) => k.count > 0)
      .sort((a, b) => b.count - a.count);
    const first = state.months[state.months.length - 1]?.month;
    body = (
      <>
        <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('allTitle')}>
          <CardHeader
            icon="volunteer_activism"
            title={t('allSummary', { count: total, people: state.people })}
            subtitle={first ? t('allSince', { month: monthName(first) }) : undefined}
          />
          <ul className="kudos-tally">
            {tally.map(({ tag, count }) => (
              <li key={tag} className="kudos-tally-row">
                <span className="kudos-tag"><span className="material-icons" aria-hidden="true">{TAG_ICON[tag]}</span>{t(`tag.${tag}`)}</span>
                <span className="kudos-bar" aria-hidden="true"><span style={{ width: `${(count / top) * 100}%` }} /></span>
                <span className="kudos-tally-n">{count}</span>
              </li>
            ))}
          </ul>
          <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>
            {t.rich('mostNoticed', { tag: t(`tag.${tally[0].tag}`), b: (c) => <b style={{ color: 'var(--text-primary)' }}>{c}</b> })}
          </p>
        </section>

        <section className="glass-card p-5 flex flex-col gap-3" aria-label={t('allHeading')}>
          <div>
            <p className="section-label-muted m-0">{t('allHeading')}</p>
            <p className="fs-sm m-0" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-05)' }}>{t('allHint')}</p>
          </div>
          {state.months.map((mo) => (
            <div key={mo.month} className="kudos-month">
              <p className="kudos-month-label">{monthName(mo.month)}</p>
              {mo.notes.map((n) => (
                <div key={`${n.createdAt}-${n.raterName}-${n.tag}`} className="kudos-note">
                  <p className="fs-md m-0" style={{ color: 'var(--text-primary)' }}>{n.note}</p>
                  <p className="kudos-note-meta">
                    <MemberAvatar name={n.raterName} size={18} />
                    {n.raterName}
                    {' · '}
                    {t(`tag.${n.tag}`)}
                    {isSkillKey(n.skillKey) ? ` · ${skillText.label(n.skillKey)}` : ''}
                    {' · '}
                    {new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Vancouver' }).format(new Date(n.createdAt))}
                  </p>
                </div>
              ))}
              {mo.tags.length > 0 && (
                <div className="kudos-bare">
                  <span className="kudos-bare-tags">
                    {mo.tags.map((k) => (
                      <span key={k.tag} className="kudos-tag">
                        <span className="material-icons" aria-hidden="true">{TAG_ICON[k.tag]}</span>
                        {t(`tag.${k.tag}`)}{k.count > 1 ? ` ×${k.count}` : ''}
                      </span>
                    ))}
                  </span>
                  <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('bareFrom')}</span>
                </div>
              )}
            </div>
          ))}
        </section>

        <p className="fs-sm m-0" style={{ color: 'var(--text-muted)', padding: '0 var(--space-1)' }}>{t('allPrivacy')}</p>
      </>
    );
  }

  return (
    <div className="animate-slideInRight fit-page">
      <TopBar title={t('allTitle')} onBack={onBack} backLabel={t('back')} />
      {body}
    </div>
  );
}

/** A stored key, not a label: an unknown key renders as nothing. */
function isSkillKey(key?: string): key is string {
  return !!key && SKILLS.some((s) => s.key === key);
}
