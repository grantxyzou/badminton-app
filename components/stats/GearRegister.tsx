'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import RacketRow from './RacketRow';
import StringTensionCard from './StringTensionCard';
import type { EquipmentCategory, GearItem } from '@/lib/types';
import type { ClubGearEntry } from '@/lib/clubGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The Gear register: your racket (existing bag surface), your kit at a glance,
 * string tension advice, and what the club plays.
 *
 * SCOPE NOTE — the four-category recommendation rail from the design is NOT
 * here, and its absence is deliberate rather than forgotten. The
 * `equipmentCatalog` seed contains 71 rackets and zero shoes, strings or
 * shuttles, so a four-card rail would render three cards that either say
 * nothing or invent product data. Sourcing real shoe/string/shuttle rows with
 * honest prices is a data task, not a UI one. The racket recommendation keeps
 * working through RacketRow, and the kit rows below already accept every
 * category so the write surface is ready when the catalog is.
 */

const CATEGORIES: { key: EquipmentCategory; labelKey: string; icon: string }[] = [
  { key: 'racket', labelKey: 'catRacket', icon: 'sports_tennis' },
  { key: 'string', labelKey: 'catString', icon: 'science' },
  { key: 'shoe', labelKey: 'catShoe', icon: 'fitness_center' },
  { key: 'shuttle', labelKey: 'catShuttle', icon: 'inventory_2' },
];

export interface GearRegisterProps {
  activeName: string | null;
}

export default function GearRegister({ activeName }: GearRegisterProps) {
  return (
    <>
      <RacketRow />
      <YourKitCard activeName={activeName} />
      <StringTensionCard activeName={activeName} />
      <ClubGearCard />
    </>
  );
}

function YourKitCard({ activeName }: { activeName: string | null }) {
  const t = useTranslations('stats.gear');
  const [items, setItems] = useState<GearItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setItems((d?.gear?.items ?? []) as GearItem[]);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));
    return () => {
      live = false;
    };
  }, [activeName]);

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={220} />;

  // Legacy gear docs predate `category` and are all rackets — same read
  // tolerance as normalizeBirdUsages.
  const byCategory = new Map<EquipmentCategory, GearItem>();
  for (const item of items) {
    if (!item || item.retiredAt) continue;
    const cat = (item.category ?? 'racket') as EquipmentCategory;
    if (!byCategory.has(cat)) byCategory.set(cat, item);
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="inventory_2" title={t('kitTitle')} subtitle={t('kitSubtitle')} />
      {status === 'error' ? (
        <ErrorState message={t('kitError')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {CATEGORIES.map(({ key, labelKey, icon }) => {
            const item = byCategory.get(key);
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                }}
              >
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}
                >
                  {icon}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--fs-2xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                      fontWeight: 700,
                    }}
                  >
                    {t(labelKey)}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontSize: 'var(--fs-md)',
                      color: item ? 'var(--text-primary)' : 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item?.label ?? t('notSet')}
                  </span>
                </span>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                  {item ? t('change') : t('add')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ClubGearCard() {
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
