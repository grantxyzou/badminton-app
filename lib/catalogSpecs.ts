import type { CatalogItem, EquipmentCategory } from './types';

/**
 * The spec sheet: the attributes a member checks before buying, each with a
 * label.
 *
 * This used to be `Object.values(attrs).join(' · ')` — every field the catalog
 * carries, unlabelled, in key order. On a racket that was merely dense. On a
 * string it printed twenty-eight values including bare sub-ratings
 * ("· 8 · 8 · 7 · 7 ·"), the reel length, the colour list, and the maintenance
 * fields `ratingSource` and `lastVerified`. A spec sheet nobody can read is
 * not a spec sheet, and the stated job of this half of the sheet is to be
 * "what they check afterwards".
 *
 * Curated per category rather than blocklisted, so a new catalog field is
 * invisible here until someone decides it belongs — the safe direction. A
 * category with no list falls back to the old dump.
 */
const SPEC_ROWS: Partial<Record<EquipmentCategory, Array<{ labelKey: string; render: (a: Record<string, string | number>) => string | null }>>> = {
  racket: [
    { labelKey: 'specWeight', render: (a) => (a.weight ? String(a.weight) : null) },
    { labelKey: 'specBalance', render: (a) => (a.balance ? String(a.balance) : null) },
    { labelKey: 'specFlex', render: (a) => (a.flex ? String(a.flex) : null) },
    { labelKey: 'specStyle', render: (a) => (a.playStyle ? String(a.playStyle) : null) },
    { labelKey: 'specTension', render: (a) => tensionRange(a) },
  ],
  string: [
    { labelKey: 'specGauge', render: (a) => (typeof a.gaugeMm === 'number' ? `${a.gaugeMm.toFixed(2)}mm` : null) },
    { labelKey: 'specType', render: (a) => (a.stringType ? String(a.stringType) : null) },
    { labelKey: 'specFeel', render: (a) => (a.feel ? String(a.feel) : null) },
    { labelKey: 'specTension', render: (a) => tensionRange(a) },
    { labelKey: 'specRepulsion', render: (a) => (typeof a.repulsion === 'number' ? `${a.repulsion}/10` : null) },
    { labelKey: 'specDurability', render: (a) => (typeof a.durability === 'number' ? `${a.durability}/10` : null) },
    { labelKey: 'specLevel', render: (a) => (a.skillLevel ? String(a.skillLevel) : null) },
  ],
};

function tensionRange(a: Record<string, string | number>): string | null {
  const lo = a.tensionMinLbs;
  const hi = a.tensionMaxLbs;
  if (typeof lo !== 'number' || typeof hi !== 'number') return null;
  return `${lo}–${hi} lb`;
}

export interface CatalogSpecRow {
  /** A `stats.gear` key. */
  labelKey: string;
  value: string;
}

/** The curated, labelled spec rows for one catalog item; empty for a category
 *  with no list. Shared by `GearPickSheet` and the Set-up line sheet, so a
 *  racket's "Full specs" cannot say two different things in two places. */
export function catalogSpecRows(item: CatalogItem): CatalogSpecRow[] {
  return (SPEC_ROWS[item.category] ?? [])
    .map((r) => ({ labelKey: r.labelKey, value: r.render(item.attributes ?? {}) }))
    .filter((r): r is CatalogSpecRow => Boolean(r.value));
}
