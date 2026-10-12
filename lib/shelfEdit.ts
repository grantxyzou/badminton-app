import { MAX_PRICE_CENTS } from './stringingRateCard';
import { labelKey } from './stringStockMath';
import type { CatalogItem, StringPurchase } from './types';

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

/**
 * The purchases that count toward one shelf string: its own spelling, an
 * alias that points at it, or (the #603 rename rule) the catalog row it is
 * linked to. The same three routes `summarizeStringStock` takes, so the list
 * under a string is the list its stock was counted from.
 */
export function purchasesFor(
  label: string,
  purchases: readonly StringPurchase[],
  aliases: Readonly<Record<string, string>>,
  catalogId: string | null,
  offered: readonly string[],
): StringPurchase[] {
  const key = labelKey(label);
  const offeredKeys = new Set(offered.map(labelKey));
  const aliasKeys = new Set(Object.entries(aliases).filter(([, to]) => to === label).map(([from]) => labelKey(from)));
  return purchases.filter((p) => {
    const own = labelKey(p.label);
    if (own === key || aliasKeys.has(own)) return true;
    return !offeredKeys.has(own) && !!catalogId && p.catalogId === catalogId;
  });
}
