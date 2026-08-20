'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import GearSheet from './GearSheet';
import type { UseGear } from './useGear';
import type { EquipmentCategory, GearItem } from '@/lib/types';
import { gearItemLabel } from '@/lib/tension';

const CATEGORIES: { key: EquipmentCategory; labelKey: string; icon: string }[] = [
  { key: 'racket', labelKey: 'catRacket', icon: 'sports_tennis' },
  { key: 'string', labelKey: 'catString', icon: 'science' },
  { key: 'shoe', labelKey: 'catShoe', icon: 'fitness_center' },
  { key: 'shuttle', labelKey: 'catShuttle', icon: 'inventory_2' },
];

/**
 * Categories a player can actually pick from. Driven by whether the catalog
 * has rows, not by a flag — same rule as the rail, so the two can never
 * disagree about whether a category is ready.
 */
const PICKABLE: EquipmentCategory[] = ['racket', 'string'];

export interface YourKitCardProps {
  activeName: string | null;
  /**
   * The register's single `UseGear` object. This card MUST NOT call `useGear`
   * itself: a second instance holds its own state with no shared store, which
   * is how adding a racket here used to leave every other gear surface stale
   * until reload. See `GearRegister`'s docstring.
   */
  gear: UseGear;
}

/** `notSet` for an empty row, `gearItemLabel` (shared with `BagList`) for a
 *  filled one — see `lib/tension.ts` for why the formatting lives there. */
function kitValue(item: GearItem | undefined, t: (key: string) => string): string {
  if (!item) return t('notSet');
  return gearItemLabel(item, t('lb'));
}

/**
 * "Your kit" — one row per equipment category, showing what the member owns
 * and offering the door to change it.
 *
 * Two surfaces, two jobs, deliberately not two doors to the same room:
 *   - the pick rail INFORMS (what we'd suggest, and whether you own it)
 *   - these rows MANAGE (tap to pick or change)
 */
export default function YourKitCard({ activeName, gear }: YourKitCardProps) {
  const t = useTranslations('stats.gear');
  const { gear: doc, loaded, loadError, busy, online, add, activate, remove, active } = gear;
  const [picking, setPicking] = useState<EquipmentCategory | null>(null);

  const items = (doc?.items ?? []) as GearItem[];
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

  const ownedItemsForPicking = picking
    ? items.filter((i) => !i.retiredAt && ((i.category ?? 'racket') as EquipmentCategory) === picking)
    : [];

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
                    {kitValue(item, t)}
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

      {/* One picker, driven by which row was tapped. GearSheet is the single
          place a category's items live — owned items plus the catalog to add
          or change them — and is category-agnostic, so strings reuse it
          rather than getting a near-copy that drifts. */}
      <GearSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        category={picking ?? 'racket'}
        title={picking === 'string' ? t('pickString') : t('pickRacket')}
        hint={picking === 'string' ? t('pickStringHint') : undefined}
        ownedCatalogIds={ownedItemsForPicking
          .map((i) => i.catalogId)
          .filter((id): id is string => typeof id === 'string')}
        ownedItems={ownedItemsForPicking}
        activeItemId={active?.id}
        onActivate={(id) => { void activate(id); }}
        onRemove={(id) => { void remove(id); }}
        onPick={(item, tensionLbs) => add(item, typeof tensionLbs === 'number' ? { tensionLbs } : undefined)}
        busy={busy}
        online={online}
        activeName={activeName}
        format={doc?.playFormat}
      />
    </div>
  );
}
