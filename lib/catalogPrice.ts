import type { CatalogItem } from './types';

/**
 * ONE price per catalog row, everywhere it is shown (Grant, 2026-09-14).
 *
 * A racket used to carry two: a hand-set CAD `msrp` for the pick sheets and a
 * sourced USD range for its page, and on nine rows they had drifted apart — the
 * 3D Calibar 900 read $209 on the pick sheet and $345–$415 on its own page.
 * Both now come from the sourced USD figures here, and `msrp` is written from
 * the same formula (`__tests__/catalog-price.test.ts` holds every row to it),
 * so the budget and "$20 cheaper" maths agree with what is displayed.
 */

/** USD → CAD for a TYPICAL price. A rough constant, captioned as typical where a
 *  range is shown; it is not a live rate and must never read as one. */
export const USD_TO_CAD = 1.38;

const num = (row: CatalogItem, key: string): number | null => {
  const v = row.attributes?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** The sourced USD bounds: a racket's frame price, a string's set price. */
function usdBounds(row: CatalogItem): [number | null, number | null] {
  return row.category === 'string'
    ? [num(row, 'priceSetUsdMin'), num(row, 'priceSetUsdMax')]
    : [num(row, 'priceMinUSD'), num(row, 'priceMaxUSD')];
}

/** The single figure a list shows ("~$400"): the low end of the typical price in
 *  CAD, or the row's own `msrp` when it has no sourced USD figure. */
export function priceCadPoint(row: CatalogItem): number | null {
  const [lo] = usdBounds(row);
  if (lo !== null) return Math.round(lo * USD_TO_CAD);
  return typeof row.msrp === 'number' && row.msrp > 0 ? row.msrp : null;
}

/** A typical retail range in CAD, rounded to $5, or null without both bounds. */
export function cadRange(row: CatalogItem): [number, number] | null {
  const [lo, hi] = usdBounds(row);
  if (lo === null || hi === null || hi < lo) return null;
  const five = (usd: number) => Math.round((usd * USD_TO_CAD) / 5) * 5;
  return [five(lo), five(hi)];
}
