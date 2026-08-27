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
  /** Where this pick's performance numbers came from, when they are not the
   *  manufacturer's. Rendered in the muted caveat paragraph under the action,
   *  NOT with `warnings` — this is sourcing, not a safety flag, and only some
   *  catalog rows carry it. Absent means published. */
  provenance?: string;
  /** Which racket this pick was scored against, and whether the member owns
   *  it. String picks are pairings, not standalone recommendations — a string
   *  shown without the frame it assumed is advice for someone else's racket.
   *  Absent for categories scored against the player rather than a frame. */
  pairedWith?: { label: string; source: 'owned' | 'recommended' };
  /** Tension for THIS string on THAT frame, placed inside the pair's overlap
   *  window. Null when the frame publishes no ceiling — 11 of the 71 catalog
   *  rackets — in which case `StringTensionCard`'s level-based number stands
   *  in (spec D2). */
  tensionLbs?: number | null;
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
  /** i18n key for the parked body line. Every category has a dedicated one;
   *  a category with no `soonKey` would fall back to `railComingSoon` for
   *  both the badge AND the body, reading as a duplicated "Coming soon /
   *  Coming soon" card — that was `racket`'s bug before `railRacketSoon` was
   *  added (racket parks on `needsCheckIn` or the flag being off, not on a
   *  missing engine — see GearPickRail's SOURCED list). */
  soonKey?: string;
  /** i18n key for the parked BADGE. Defaults to `railComingSoon`, which is
   *  true for string/shoe/shuttle (no engine exists yet) but FALSE for
   *  racket — the engine ships today, so a racket card parked on
   *  `needsCheckIn` (or the rarer empty-catalog case; GearPickRail
   *  deliberately doesn't distinguish the two — see its own comment) must
   *  not claim the FEATURE itself is coming soon. `railNoPickYet` is
   *  deliberately reason-agnostic ("No pick yet", not "check in first") so
   *  it stays true on whichever of those two causes actually parked the
   *  card — the `soonKey` body line is where the specific, common-case
   *  nudge ("do a check-in") lives. Keep this in sync with `soonKey`: a
   *  category whose badge and body tell two different stories ("Coming
   *  soon" next to "do a check-in") is worse than the plain duplication
   *  this pairing exists to avoid. */
  badgeKey?: string;
}

const META: Record<EquipmentCategory, CategoryMeta> = {
  racket: {
    labelKey: 'catRacket', icon: 'sports_tennis', color: 'var(--accent)',
    soonKey: 'railRacketSoon', badgeKey: 'railNoPickYet',
  },
  // String parks like racket, not like shoe: it HAS an engine now, so a parked
  // card means "no check-in yet" or an empty catalog — never "the feature is
  // coming". Without the badgeKey override this defaults to `railComingSoon`
  // and disowns something that ships, which is exactly what 6f7ea48 fixed for
  // racket.
  string: {
    labelKey: 'catString', icon: 'science', color: 'var(--sev-low-label)',
    soonKey: 'railStringsSoon', badgeKey: 'railNoPickYet',
  },
  shoe: { labelKey: 'catShoe', icon: 'fitness_center', color: 'var(--accent-amber)', soonKey: 'railShoesSoon' },
  shuttle: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)', soonKey: 'railShuttlesSoon' },
  bag: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)' },
  grip: { labelKey: 'catShuttle', icon: 'inventory_2', color: 'var(--text-primary)' },
};

/** Fixed rail-card width from the artboard (Stage 6). Every state renders at
 *  this width so the rail never reflows as cards settle from loading to ready. */
const CARD_WIDTH = 236;

/** The two attributes worth two lines of card, per category. Named rather
 *  than positional: this used to take the first two values in key order, which
 *  gave rackets "3U/4U · Head-heavy" only because that is how the seed rows
 *  happen to be written, and gave the Li-Ning N69 "N · Durability" — "N" being
 *  the series letter. Cosmos does not guarantee key order, so the racket line
 *  was one row-rewrite away from breaking the same way. */
const SPEC_FIELDS: Partial<Record<EquipmentCategory, [string, string]>> = {
  racket: ['weight', 'balance'],
  string: ['gaugeMm', 'stringType'],
};

function formatSpec(item: CatalogItem): string | null {
  if (!item.attributes) return null;
  const fields = SPEC_FIELDS[item.category];

  const values = fields
    ? fields
        // Keep each value BOUND to its field name. Mapping to bare values and
        // then filtering reindexes the array, so a later `fields[i]` lookup
        // read the wrong name: a string row missing `gaugeMm` but carrying
        // `stringType` collapsed to index 0, matched 'gaugeMm', and rendered
        // `Number('Durability').toFixed(2)` — "NaNmm" on the card. The seed
        // has gaugeMm on all 46 rows, but Cosmos holds admin-authored rows
        // that seeding never refreshes, so the seed passing proves nothing.
        .map((f) => ({ field: f, value: item.attributes?.[f] }))
        .filter(({ value }) => value !== undefined && value !== null && value !== '')
        // Gauge is the one numeric spec, and a bare "0.65" next to a word
        // reads as a rating rather than a thickness.
        .map(({ field, value }) => {
          if (field !== 'gaugeMm') return String(value);
          const n = Number(value);
          // Still guard the value itself: a non-numeric gaugeMm must not
          // become "NaNmm" either. Fall back to showing what is actually there.
          return Number.isFinite(n) ? `${n.toFixed(2)}mm` : String(value);
        })
    // A category with no named pair (shoe, shuttle — neither has catalog rows
    // yet) keeps the old positional behaviour rather than rendering nothing.
    : Object.values(item.attributes).slice(0, 2).map(String);

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
          gap: 'var(--space-2)',
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
          <StatusBadge variant="muted">{t(meta.badgeKey ?? 'railComingSoon')}</StatusBadge>
          <span
            className="material-icons"
            aria-hidden="true"
            style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)', marginLeft: 'auto' }}
          >
            {meta.icon}
          </span>
        </span>
        <span className="fs-base" style={{ marginTop: 'var(--space-2)', lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
          {t(meta.soonKey ?? 'railComingSoon')}
        </span>
      </div>
    );
  }

  // Ready with a real pick. The whole card is the tap target — it opens the
  // full detail sheet (reasons + Add to my kit) rather than expanding inline,
  // so a 44px+ touch target is trivially satisfied.
  const { item } = pick;
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
        gap: 'var(--space-2)',
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

      {/* Three different claims, and only the first two are about ownership.
          `owned` means "you own THIS pick", never "you own a racket" — the
          member's own kit lives in `YourKitCard`, which reads the same gear
          document. Saying "Yours · none on file" on the not-owned branch
          therefore told a member holding an Aeronaut 9000 that their kit was
          empty. The not-owned branch now states what the card is actually
          doing (matching the pick to how they play) instead of making an
          ownership claim it has no basis for. */}
      <span className="fs-xs" style={{ color: 'var(--text-muted)' }}>
        {pick.pairedWith
          ? t(pick.pairedWith.source === 'owned' ? 'railPairedYours' : 'railPairedOurs', {
              label: pick.pairedWith.label,
            })
          : owned ? t('railInKitLine') : t('railStyleMatched')}
      </span>

      <span style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-md)', fontWeight: 600, lineHeight: 'var(--lh-snug)', color: 'var(--text-primary)' }}>
        {item.model}
      </span>
      <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
        {spec ? `${item.brand} · ${spec}` : item.brand}
      </span>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-05)',
          marginTop: 'auto',
          paddingTop: 'var(--space-1)',
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
