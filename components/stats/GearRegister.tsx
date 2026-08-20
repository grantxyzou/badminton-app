'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import RacketRow from './RacketRow';
import GearRail from './GearRail';
import GearSheet from './GearSheet';
import { useGear } from './useGear';
import StringTensionCard from './StringTensionCard';
import type { EquipmentCategory, GearItem } from '@/lib/types';
import type { ClubGearEntry } from '@/lib/clubGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The Gear register: your racket (existing bag surface), your kit at a glance,
 * string tension advice, and what the club plays.
 *
 * SCOPE — rackets and strings are SELECTABLE; shoes and shuttles are parked
 * because the catalog has no rows for them, not because the UI is missing.
 * Both the rail and the kit rows key off `PICKABLE`/a catalog probe rather
 * than a flag, so sourcing rows is the only step to un-park a category.
 *
 * Two surfaces, two jobs, deliberately not two doors to the same room:
 *   - the rail INFORMS (what the category is for, what you own)
 *   - the kit rows MANAGE (tap to pick or change)
 * RacketRow stays the racket-specific deep-dive it already was.
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
      <GearRail activeName={activeName} />
      <YourKitCard activeName={activeName} />
      <StringTensionCard activeName={activeName} />
      <ClubGearCard />
    </>
  );
}

/**
 * Categories a player can actually pick from. Driven by whether the catalog
 * has rows, not by a flag — same rule as the rail, so the two can never
 * disagree about whether a category is ready.
 */
const PICKABLE: EquipmentCategory[] = ['racket', 'string'];

function YourKitCard({ activeName }: { activeName: string | null }) {
  const t = useTranslations('stats.gear');
  // useGear is the SINGLE owner of gear state (components/stats/CLAUDE.md:
  // "Never add a gear fetch outside this hook"). This card used to run its own
  // fetch; now it reads and writes through the hook so the kit, the bag and
  // the rail cannot drift out of sync after an add.
  const { gear, loaded, loadError, busy, online, add } = useGear(activeName);
  const [picking, setPicking] = useState<EquipmentCategory | null>(null);

  const items = (gear?.items ?? []) as GearItem[];
  const status: 'loading' | 'ready' | 'error' = loadError ? 'error' : loaded ? 'ready' : 'loading';

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
            const pickable = PICKABLE.includes(key);
            // A row that says "Add" and does nothing is worse than a row that
            // says nothing. Unsourced categories render as a plain div with no
            // action word at all, matching the rail's parked cards.
            const Row = pickable ? 'button' : 'div';
            return (
              <Row
                key={key}
                {...(pickable
                  ? {
                      type: 'button' as const,
                      onClick: () => setPicking(key),
                      disabled: busy,
                      'aria-label': `${t(labelKey)} — ${item ? t('change') : t('add')}`,
                    }
                  : {})}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                  width: '100%',
                  textAlign: 'left',
                  cursor: pickable ? 'pointer' : 'default',
                  opacity: pickable ? 1 : 0.6,
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
                {pickable && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                    {item ? t('change') : t('add')}
                  </span>
                )}
              </Row>
            );
          })}
        </div>
      )}

      {/* One picker, driven by which row was tapped. GearSheet is "a catalog
          picker and nothing else" and is category-agnostic, so strings reuse it
          rather than getting a near-copy that drifts. */}
      <GearSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        category={picking ?? 'racket'}
        title={picking === 'string' ? t('pickString') : t('pickRacket')}
        hint={picking === 'string' ? t('pickStringHint') : undefined}
        ownedCatalogIds={items
          .filter((i) => ((i.category ?? 'racket') as EquipmentCategory) === picking)
          .map((i) => i.catalogId)
          .filter((id): id is string => typeof id === 'string')}
        onPick={add}
        busy={busy}
        online={online}
      />
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
