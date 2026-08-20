'use client';

import { useTranslations } from 'next-intl';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import type { CatalogItem, EquipmentCategory } from '@/lib/types';

/** A resolved recommendation for one category: the catalog row plus the
 *  why-this lines the engine produced for it. */
export interface GearPick {
  item: CatalogItem;
  reasons: string[];
  /** Safety flags the engine raised about this pick (e.g. a weight warning).
   *  Optional so existing `GearPick` literals still type-check, but never
   *  optional to DISPLAY: `GearPickSheet` renders warnings uncollapsed. A card
   *  that hides a real warning is worse than a card that expands nothing. */
  warnings?: string[];
}

export type GearPickCardStatus = 'loading' | 'ready' | 'error' | 'parked';

export interface GearPickCardProps {
  category: EquipmentCategory;
  pick: GearPick | null;
  /** True when `pick.item` is already in the member's kit. Drives the
   *  IN YOUR KIT flip — the bug this redesign exists to fix was recommending
   *  back the racket the member already owns. */
  owned: boolean;
  status: GearPickCardStatus;
  onOpen: () => void;
}

interface CategoryMeta {
  labelKey: string;
  icon: string;
  color: string;
  /** i18n key for the parked body line. Categories with a live engine today
   *  (racket) don't have a dedicated one — see GearPickRail's SOURCED list —
   *  so this falls back to `railComingSoon` for both the badge and the body. */
  soonKey?: string;
}

const META: Record<EquipmentCategory, CategoryMeta> = {
  racket: { labelKey: 'catRacket', icon: 'sports_tennis', color: 'var(--accent)' },
  string: { labelKey: 'catString', icon: 'science', color: 'var(--sev-low-text)', soonKey: 'railStringsSoon' },
  shoe: { labelKey: 'catShoe', icon: 'fitness_center', color: 'var(--accent-amber)', soonKey: 'railShoesSoon' },
  shuttle: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)', soonKey: 'railShuttlesSoon' },
  bag: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)' },
  grip: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)' },
};

/** Fixed rail-card width from the artboard (Stage 6). Every state renders at
 *  this width so the rail never reflows as cards settle from loading to ready. */
const CARD_WIDTH = 236;

function formatSpec(item: CatalogItem): string | null {
  if (!item.attributes) return null;
  const values = Object.values(item.attributes).slice(0, 2).map(String);
  return values.length > 0 ? values.join(' · ') : null;
}

export default function GearPickCard({ category, pick, owned, status, onOpen }: GearPickCardProps) {
  const t = useTranslations('stats.gear');
  const meta = META[category];

  if (status === 'loading') {
    return (
      <div style={{ width: CARD_WIDTH, flex: '0 0 auto' }}>
        <CardSkeleton height={168} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="glass-card p-4" style={{ width: CARD_WIDTH, flex: '0 0 auto' }}>
        <ErrorState message={t('kitError')} />
      </div>
    );
  }

  // A valid category with no possible pick — either genuinely parked (no
  // engine yet) or ready-but-empty (e.g. the member hasn't taken a
  // self-assessment). Either way there is nothing to recommend right now, and
  // the honest move is the same card that names what the category will do,
  // never an empty box.
  if (status === 'parked' || !pick) {
    return (
      <div
        className="glass-card p-4"
        style={{
          width: CARD_WIDTH,
          flex: '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          opacity: 0.72,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            className="fs-2xs"
            style={{ color: meta.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}
          >
            {t(meta.labelKey)}
          </span>
          <StatusBadge variant="muted">{t('railComingSoon')}</StatusBadge>
          <span
            className="material-icons"
            aria-hidden="true"
            style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)', marginLeft: 'auto' }}
          >
            {meta.icon}
          </span>
        </span>
        <span className="fs-base" style={{ marginTop: 6, lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
          {t(meta.soonKey ?? 'railComingSoon')}
        </span>
      </div>
    );
  }

  // Ready with a real pick. The whole card is the tap target — it opens the
  // full detail sheet (reasons + Add to my kit) rather than expanding inline,
  // so a 44px+ touch target is trivially satisfied.
  const { item } = pick;
  const label = `${item.brand} ${item.model}`;
  const spec = formatSpec(item);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="glass-card p-4"
      aria-label={`${t(meta.labelKey)} — ${owned ? t('railWhyPicked') : t('railWhy')}`}
      style={{
        width: CARD_WIDTH,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: 44,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          className="fs-2xs"
          style={{ color: meta.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}
        >
          {t(meta.labelKey)}
        </span>
        {owned && <StatusBadge variant="accent">{t('railInKit')}</StatusBadge>}
        <span
          className="material-icons"
          aria-hidden="true"
          style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)', marginLeft: 'auto' }}
        >
          {meta.icon}
        </span>
      </span>

      <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>
        {owned ? t('railYours', { label }) : t('railNone')}
      </span>

      <span style={{ marginTop: 6, fontSize: 'var(--fs-md)', fontWeight: 600, lineHeight: 'var(--lh-snug)', color: 'var(--text-primary)' }}>
        {item.model}
      </span>
      <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
        {spec ? `${item.brand} · ${spec}` : item.brand}
      </span>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          marginTop: 'auto',
          paddingTop: 4,
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-secondary)',
        }}
      >
        {owned ? t('railWhyPicked') : t('railWhy')}
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-sm)' }}>
          chevron_right
        </span>
      </span>
    </button>
  );
}
