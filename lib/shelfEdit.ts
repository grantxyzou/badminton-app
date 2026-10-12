import { MAX_PRICE_CENTS } from './stringingRateCard';
import type { CatalogItem } from './types';

/**
 * The bench's string-shelf editing rules, pure and client-safe. Lifted out of
 * the retired `OfferedStringsCard` when "Strings you stock" and "String stock"
 * became one list (docs/plans/bench-redesign.md), so the list and its sheet
 * read one definition.
 */

export const catalogLabel = (i: CatalogItem) => `${i.brand} ${i.model}`;

/** "32" or "29.50" → cents; "" → null ("Ask"); anything else → undefined (not savable). */
export function parsePrice(draft: string): number | null | undefined {
  const t = draft.trim().replace(/^\$/, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const cents = Math.round(Number(t) * 100);
  return cents >= 0 && cents <= MAX_PRICE_CENTS ? cents : undefined;
}

/** What the price field shows for a stored price: "32", "29.50", or "" for Ask / unset. */
export function priceDraftOf(cents: number | null | undefined): string {
  if (typeof cents !== 'number') return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Catalog strings whose brand or model carries every word typed. */
export function matches(items: readonly CatalogItem[], query: string, limit = 5): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items
    .filter((i) => {
      const hay = catalogLabel(i).toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}
