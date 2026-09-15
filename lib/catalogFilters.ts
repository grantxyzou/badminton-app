import type { CatalogItem } from './types';

/**
 * The "Add a racket" / "Add strings" filters (design "Equipment redesign" 2a,
 * screen 02): search leads, facets narrow. One value per facet.
 *
 * Pure so the rule QA keeps catching can be tested as arithmetic: every row
 * shown must satisfy every applied chip, and every count must be the count of
 * the rows actually shown.
 */

export type Facet = 'brand' | 'weight' | 'balance' | 'flex' | 'type';
export type Applied = Partial<Record<Facet, string>>;

export const FACETS: Record<'racket' | 'string', Facet[]> = {
  racket: ['brand', 'weight', 'balance', 'flex'],
  string: ['brand', 'type'],
};

/** Display order for values that have a natural one. Anything not listed
 *  follows, in the order the catalog first uses it. */
const ORDER: Partial<Record<Facet, string[]>> = {
  weight: ['3U', '4U', '5U'],
  balance: ['Head-light', 'Even', 'Head-heavy'],
  flex: ['Flexible', 'Medium', 'Medium-Stiff', 'Stiff', 'Extra Stiff'],
};

/** The values a row carries for a facet. A dual weight class ("3U/4U") is
 *  both classes: a 4U filter must not hide a frame sold in 3U and 4U. */
export function valuesOf(item: CatalogItem, facet: Facet): string[] {
  if (facet === 'brand') return [item.brand];
  const key = facet === 'type' ? 'stringType' : facet;
  const raw = item.attributes?.[key];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return facet === 'weight' ? raw.split('/').map((v) => v.trim()).filter(Boolean) : [raw.trim()];
}

export function facetValues(items: CatalogItem[], facet: Facet): string[] {
  const seen: string[] = [];
  for (const item of items) for (const v of valuesOf(item, facet)) if (!seen.includes(v)) seen.push(v);
  const order = ORDER[facet];
  if (!order) return seen;
  return [...order.filter((v) => seen.includes(v)), ...seen.filter((v) => !order.includes(v))];
}

export function matchesFilters(item: CatalogItem, applied: Applied): boolean {
  return (Object.entries(applied) as Array<[Facet, string | undefined]>).every(
    ([facet, value]) => value === undefined || valuesOf(item, facet).includes(value),
  );
}

export function applyFilters(items: CatalogItem[], applied: Applied): CatalogItem[] {
  return hasFilters(applied) ? items.filter((i) => matchesFilters(i, applied)) : items;
}

export function hasFilters(applied: Applied): boolean {
  return Object.values(applied).some((v) => v !== undefined);
}
