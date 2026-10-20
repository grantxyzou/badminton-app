import { describe, it, expect } from 'vitest';
import seed from '../scripts/data/equipment-catalog.json';
import { STRING_PATTERNS, grommetHoles } from '../lib/stringPatterns';
import { specCells } from '../lib/frameDetail';
import type { CatalogItem } from '../lib/types';

/** docs/plans/grommet-holes.md, Phase 1: a hole count is only ever as good as
 *  where it came from, and it lives on the pattern, never on the row. */

const rackets = (seed as unknown as { items: CatalogItem[] }).items.filter((i) => i.category === 'racket');
const byId = (id: string) => rackets.find((r) => r.id === id)!;

describe('string patterns', () => {
  it('every pattern a racket names exists, and belongs to the racket’s own maker', () => {
    for (const r of rackets) {
      const id = r.attributes?.stringPattern;
      if (id === undefined) continue;
      expect(STRING_PATTERNS[String(id)], r.id).toBeDefined();
      expect(STRING_PATTERNS[String(id)].brand).toBe(r.brand);
    }
  });

  it('maps the 38 Yonex rackets whose code is on Yonex’s sheet, and no one else', () => {
    const mapped = rackets.filter((r) => r.attributes?.stringPattern !== undefined);
    expect(mapped).toHaveLength(38);
    expect(mapped.every((r) => r.brand === 'Yonex')).toBe(true);
  });

  it('every count says how it is known, and a retailer count needs two retailers', () => {
    for (const [id, p] of Object.entries(STRING_PATTERNS)) {
      if (p.holes === null) {
        expect(p.holesSource, id).toBeUndefined();
        continue;
      }
      expect(p.holes, id).toBeGreaterThanOrEqual(68);
      expect(p.holes, id).toBeLessThanOrEqual(90);
      expect(p.holesSource, id).toBeDefined();
      if (p.holesSource !== 'counted') expect(p.holesUrls?.length, id).toBeGreaterThan(0);
      if (p.holesSource === 'retailers') {
        const hosts = new Set(p.holesUrls!.map((u) => new URL(u).hostname.replace(/^www\./, '')));
        expect(hosts.size, id).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('lists each model code on one pattern only', () => {
    const codes = Object.values(STRING_PATTERNS).flatMap((p) => p.codes);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('follows the maker’s sheet, not the series: the 800 Play is not strung like the 800 Pro', () => {
    expect(grommetHoles(byId('racket-yonex-nanoflare-800-pro'))).toBe(78);
    expect(grommetHoles(byId('racket-yonex-nanoflare-800-tour'))).toBe(78);
    expect(grommetHoles(byId('racket-yonex-nanoflare-800-play'))).toBe(76);
  });

  it('leaves a racket blank when its generation is not on the sheet', () => {
    // The sheet (May 2025) lists AX99-P, the 2021 frame; the 2025 frame is 3AX99-P.
    expect(byId('racket-yonex-astrox-99-pro').attributes?.stringPattern).toBe('yonex-3');
    expect(byId('racket-yonex-astrox-99-pro-3rd-gen').attributes?.stringPattern).toBeUndefined();
    // Known pattern, no trusted count.
    expect(grommetHoles(byId('racket-yonex-astrox-99-pro'))).toBeNull();
  });

  it('shows the count on the frame page right after the rated tension, and only when known', () => {
    const keys = (id: string) => specCells(byId(id)).map((c) => c.key);
    expect(keys('racket-yonex-astrox-100zz')).toContain('holes');
    expect(keys('racket-yonex-astrox-100zz').indexOf('holes')).toBe(keys('racket-yonex-astrox-100zz').indexOf('rated') + 1);
    expect(specCells(byId('racket-yonex-astrox-100zz')).find((c) => c.key === 'holes')?.value).toBe('76');
    expect(keys('racket-yonex-astrox-99-pro')).not.toContain('holes');
    expect(keys('racket-li-ning-axforce-80')).not.toContain('holes');
  });
});
