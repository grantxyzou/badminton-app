'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import type { ClubGearEntry } from '@/lib/clubGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "What the club plays" — the aggregated kit tally.
 *
 * This card reads `/api/stats/club/gear`, which is NOT the member's gear
 * document, so its own fetch is correct and stays. The single-owner rule that
 * `GearRegister` enforces is about `GET /api/equipment/gear` specifically.
 */
export default function ClubGearCard() {
  const t = useTranslations('stats.gear');
  const [entries, setEntries] = useState<ClubGearEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/api/stats/club/gear`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setEntries((d?.entries ?? []) as ClubGearEntry[]);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, []);

  if (status === 'loading') return <CardSkeleton height={180} />;

  const top = entries.slice(0, 3);
  const max = top[0]?.count ?? 0;

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="groups" title={t('clubTitle')} subtitle={t('clubSubtitle')} />
      {status === 'error' ? (
        <ErrorState message={t('clubError')} />
      ) : top.length === 0 ? (
        <EmptyState>{t('clubEmpty')}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {top.map((e) => (
            <div key={`${e.category}:${e.label}`}>
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
                  {e.label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {e.count}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)' }}>
                <span
                  style={{
                    display: 'block',
                    height: 6,
                    borderRadius: 'var(--radius-pill)',
                    width: max > 0 ? `${(e.count / max) * 100}%` : '0%',
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('clubFootnote')}</p>
    </div>
  );
}
