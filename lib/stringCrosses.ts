import { FIELD_MAX_LB, FIELD_MIN_LB } from './tension';
import type { StringCrosses } from './types';

/**
 * The crosses half of a hybrid stringing — mains one string, crosses another,
 * each at its own tension. Stored nested on the mains string item
 * (`GearItem.crosses`), so everything that reads "the member's string" (the
 * club band, the fit verdict, the share card, the restring log) keeps reading
 * the mains, which is the figure a stringer quotes.
 */

/** A crosses value from the wire, or null when it is not one. `label` is
 *  required; a tension must be a whole pound the tension field could hold. */
export function parseCrosses(raw: unknown): StringCrosses | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 80) : '';
  if (!label) return null;
  if (r.catalogId !== undefined && r.catalogId !== null && typeof r.catalogId !== 'string') return null;
  const catalogId = typeof r.catalogId === 'string' && r.catalogId ? r.catalogId.slice(0, 120) : null;
  if (r.tensionLbs !== undefined && r.tensionLbs !== null) {
    const t = r.tensionLbs;
    if (typeof t !== 'number' || !Number.isInteger(t) || t < FIELD_MIN_LB || t > FIELD_MAX_LB) return null;
    return { catalogId, label, tensionLbs: t };
  }
  return { catalogId, label };
}
