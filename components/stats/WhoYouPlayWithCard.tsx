'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const TOP = 3;
const WEEKS = 12;

/**
 * "Who you play with" — the existing `/api/stats/partners` data re-presented
 * as bars instead of the old chip list, so relative frequency is readable at a
 * glance rather than inferred from counts.
 *
 * Known wart in the upstream route, left alone deliberately: a rate-limit trip
 * returns `{partners: []}` with a 200 rather than a 429, so a throttled read
 * is indistinguishable here from "no partners yet". Fixing that changes an
 * existing route contract and belongs with that route's own cleanup, not with
 * a presentation change.
 */
export interface WhoYouPlayWithCardProps {
  activeName: string | null;
}

interface Partner {
  name: string;
  count: number;
}

export default function WhoYouPlayWithCard({ activeName }: WhoYouPlayWithCardProps) {
  const t = useTranslations('stats.partners');
  // Shared copy for the refusal, so the three surfaces that can hit a 403 all
  // say the same thing.
  const tStats = useTranslations('stats');
  const [partners, setPartners] = useState<Partner[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');

  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(
      `${BASE}/api/stats/partners?name=${encodeURIComponent(activeName)}&weeks=${WEEKS}`,
      { cache: 'no-store' },
    )
      .then((r) => {
        // 403 is the route's owner-or-admin gate refusing, not a load failure:
        // this device holds no `member_session` cookie for the name (expired
        // 30-day cookie, or the stats preview-name path). "Couldn't load —
        // refresh to retry" would send the member round a loop that can never
        // succeed, so it gets its own branch.
        if (r.status === 403) return Promise.reject(new Error('forbidden'));
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((d) => {
        if (!live) return;
        setPartners((d?.partners ?? []) as Partner[]);
        setStatus('ready');
      })
      .catch((e: Error) => {
        if (!live) return;
        setStatus(e?.message === 'forbidden' ? 'forbidden' : 'error');
      });
    return () => {
      live = false;
    };
  }, [activeName]);

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={160} />;

  const top = partners.slice(0, TOP);
  const max = top[0]?.count ?? 0;

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="group" title={t('title')} subtitle={t('subtitle')} />
      {status === 'forbidden' ? (
        <ErrorState message={tStats('signInAgain')} />
      ) : status === 'error' ? (
        <ErrorState message={t('error')} />
      ) : top.length === 0 ? (
        <EmptyState icon="groups">{t('empty')}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {top.map((p, i) => (
            <div key={p.name}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-2)',
                  gap: 'var(--space-2)',
                }}
              >
                <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {p.count}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)' }}>
                <span
                  style={{
                    display: 'block',
                    height: 6,
                    borderRadius: 'var(--radius-pill)',
                    // Relative to the TOP partner, so the leader always fills
                    // the track and the rest read as a proportion of them.
                    width: max > 0 ? `${(p.count / max) * 100}%` : '0%',
                    // Accent fades with rank — same hue, less presence.
                    background: `color-mix(in srgb, var(--accent) ${[100, 60, 35][i] ?? 35}%, transparent)`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
