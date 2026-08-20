'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { EquipmentCategory, GearItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The category rail from the design, minus the racket.
 *
 * The racket is NOT a card here: `RacketRow` already renders a hero, a
 * recommendation and the bag directly above, and a second racket card in the
 * rail would be a second door to the same room.
 *
 * Strings, shoes and shuttles show a "Coming soon" card until the catalog can
 * answer for them. The card is honest about WHY — it names what the category
 * will do rather than being an empty box with a shrug, which is the difference
 * between "not built yet" and "broken".
 *
 * Strings flips to live automatically the moment `equipmentCatalog` has string
 * rows: the rail probes the catalog rather than reading a flag, so landing the
 * data is the only step. Shoes and shuttles stay deliberately parked.
 */

interface RailCategory {
  key: EquipmentCategory;
  labelKey: string;
  soonKey: string;
  icon: string;
  color: string;
  /** Whether to probe the catalog and go live when rows exist. */
  probe: boolean;
}

const RAIL: RailCategory[] = [
  { key: 'string', labelKey: 'catString', soonKey: 'railStringsSoon', icon: 'science', color: 'var(--sev-low-text)', probe: true },
  { key: 'shoe', labelKey: 'catShoe', soonKey: 'railShoesSoon', icon: 'fitness_center', color: 'var(--accent-amber)', probe: false },
  { key: 'shuttle', labelKey: 'catShuttle', soonKey: 'railShuttlesSoon', icon: 'inventory_2', color: 'var(--text-primary)', probe: false },
];

export interface GearRailProps {
  activeName: string | null;
}

export default function GearRail({ activeName }: GearRailProps) {
  const t = useTranslations('stats.gear');
  const [liveCategories, setLiveCategories] = useState<Set<EquipmentCategory>>(new Set());
  const [mine, setMine] = useState<Map<EquipmentCategory, GearItem>>(new Map());

  useEffect(() => {
    let live = true;
    for (const cat of RAIL.filter((c) => c.probe)) {
      fetch(`${BASE}/api/equipment/catalog?category=${cat.key}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!live) return;
          if ((d?.items ?? []).length > 0) {
            setLiveCategories((prev) => new Set(prev).add(cat.key));
          }
        })
        // A failed probe leaves the category parked. That is the safe
        // direction: a "coming soon" card is never wrong, whereas a live card
        // with nothing behind it is.
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!activeName) return;
    let live = true;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(activeName)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        const next = new Map<EquipmentCategory, GearItem>();
        for (const item of (d?.gear?.items ?? []) as GearItem[]) {
          if (!item || item.retiredAt) continue;
          const cat = (item.category ?? 'racket') as EquipmentCategory;
          if (!next.has(cat)) next.set(cat, item);
        }
        setMine(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [activeName]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        // Bleed to the column edges so the rail reads as scrollable rather
        // than as three cards that happen to be cut off.
        margin: '0 -16px',
        padding: '2px 16px 6px',
        overflowX: 'auto',
        scrollSnapType: 'x proximity',
        scrollbarWidth: 'none',
      }}
    >
      {RAIL.map((cat) => {
        const isLive = liveCategories.has(cat.key);
        const owned = mine.get(cat.key);
        return (
          <div
            key={cat.key}
            className="glass-card"
            style={{
              flex: '0 0 auto',
              width: 236,
              scrollSnapAlign: 'start',
              padding: 'var(--space-5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              // Parked categories sit back visually — same principle as
              // .cc-btn:disabled, not a different card style.
              opacity: isLive ? 1 : 0.72,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  fontSize: 'var(--fs-2xs)',
                  color: cat.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  fontWeight: 700,
                }}
              >
                {t(cat.labelKey)}
              </span>
              {!isLive && <StatusBadge variant="muted">{t('railComingSoon')}</StatusBadge>}
              {isLive && owned && <StatusBadge>{t('railInKit')}</StatusBadge>}
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)', marginLeft: 'auto' }}
              >
                {cat.icon}
              </span>
            </span>

            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {owned ? t('railYours', { label: owned.label }) : t('railNone')}
            </span>

            <span
              style={{
                marginTop: 6,
                fontSize: 'var(--fs-base)',
                lineHeight: 1.4,
                color: 'var(--text-secondary)',
              }}
            >
              {t(cat.soonKey)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
