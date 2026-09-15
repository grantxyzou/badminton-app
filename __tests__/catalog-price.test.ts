import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import seed from '../scripts/data/equipment-catalog.json';
import { cadRange, priceCadPoint, USD_TO_CAD } from '../lib/catalogPrice';
import type { CatalogItem } from '../lib/types';

/**
 * One price per row, everywhere (Grant, 2026-09-14). Nine rackets had a
 * hand-set CAD msrp that disagreed with their sourced USD range — the 3D
 * Calibar 900 showed $209 on the pick sheet and $345–$415 on its own page.
 */
const rows = (seed as unknown as { items: CatalogItem[] }).items;

describe('catalog price — one source', () => {
  it('every row with a sourced USD price carries the msrp that price implies', () => {
    const off = rows.filter((r) => {
      const lo = r.category === 'string' ? r.attributes?.priceSetUsdMin : r.attributes?.priceMinUSD;
      return typeof lo === 'number' && r.msrp !== Math.round(lo * USD_TO_CAD);
    }).map((r) => `${r.id}: msrp ${r.msrp}`);
    expect(off).toEqual([]);
  });

  it('the single figure is the low end of the range, so a list and a page agree', () => {
    const calibar = rows.find((r) => r.id === 'racket-li-ning-3d-calibar-900')!;
    const [lo] = cadRange(calibar)!;
    expect(Math.abs(priceCadPoint(calibar)! - lo)).toBeLessThanOrEqual(5);
    expect(priceCadPoint({ id: 'x', category: 'racket', msrp: 120, attributes: {} } as unknown as CatalogItem)).toBe(120);
  });

  it('no member-facing component reads msrp directly', () => {
    const dir = join(process.cwd(), 'components', 'stats');
    const readers = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /\.msrp\b/.test(readFileSync(join(dir, f), 'utf8')));
    expect(readers).toEqual([]);
  });
});
