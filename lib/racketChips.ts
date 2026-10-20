import type { CatalogItem } from './types';

/**
 * The four attributes every racket shows as chips, in one order (Grant, Stats
 * canvas, 2026-10-20: "add more reusable attributes?"): balance, shaft,
 * weight, tier. The same chips sit under the pick and on each "Or consider"
 * row, and a chip is marked where the row DIFFERS from the pick — so a member
 * compares like with like instead of reading one fragment per row.
 *
 * Pure. Reads only the catalog's controlled vocabulary
 * (`__tests__/equipment-catalog-data.test.ts`); a value outside it is left out
 * rather than shown raw, the way `specCells` drops a cell it cannot fill.
 */
export type ChipAxis = 'balance' | 'flex' | 'weight' | 'tier';

export interface RacketChip {
  axis: ChipAxis;
  /** An i18n key under `stats.gear` for balance/flex/tier; null for weight,
   *  whose value (`3U/4U`) is the same in every language. */
  key: string | null;
  /** The raw catalog value, which `weight` displays as is. */
  value: string;
  differs: boolean;
}

const BALANCE: Record<string, string> = { 'Head-heavy': 'chipBalance_headHeavy', Even: 'chipBalance_even', 'Head-light': 'chipBalance_headLight' };
const FLEX: Record<string, string> = {
  Flexible: 'chipFlex_flexible', Medium: 'chipFlex_medium', 'Medium-Stiff': 'chipFlex_mediumStiff', Stiff: 'chipFlex_stiff', 'Extra Stiff': 'chipFlex_extraStiff',
};
const TIER: Record<string, string> = { 'Entry-level': 'chipTier_entry', 'Mid-range': 'chipTier_mid', Premium: 'chipTier_premium' };

function attr(item: CatalogItem | null | undefined, field: string): string | null {
  const v = item?.attributes?.[field];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The chips for one racket, marked against `against` (the pick on show).
 *  No `against`, or the racket IS the reference: nothing is marked. */
export function racketChips(item: CatalogItem, against?: CatalogItem | null): RacketChip[] {
  if (item.category !== 'racket') return [];
  const ref = against && against.id !== item.id ? against : null;
  const out: RacketChip[] = [];
  const add = (axis: ChipAxis, field: string, table: Record<string, string> | null) => {
    const value = attr(item, field);
    if (!value) return;
    const key = table ? table[value] ?? null : null;
    if (table && !key) return;
    out.push({ axis, key, value, differs: !!ref && attr(ref, field) !== value });
  };
  add('balance', 'balance', BALANCE);
  add('flex', 'flex', FLEX);
  add('weight', 'weight', null);
  add('tier', 'tier', TIER);
  return out;
}
