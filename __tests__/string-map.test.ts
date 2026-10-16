import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  axisDomain,
  canPlot,
  dotPositions,
  placeLabels,
  DOT_PX,
  MIN_SPAN,
  SAME_POINT_SPREAD,
  type Rect,
} from '../lib/stringMap';

/**
 * The "Strings in stock" map's geometry (docs/design/strings-shelf-spec.md).
 * The mock placed its labels by hand; these hold the rule that replaced
 * that: no label leaves the plot, none overlaps a dot or another label, and
 * the selected one is always shown.
 */

const W = 300;
const H = 220;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('axisDomain', () => {
  it('pads one point either side of the plotted values', () => {
    expect(axisDomain([3, 9])).toEqual({ min: 2, max: 10 });
  });

  it('widens evenly to the minimum span', () => {
    // 7..8 pads to 6..9 (span 3), then widens half a point each way.
    expect(axisDomain([7, 8])).toEqual({ min: 5.5, max: 9.5 });
    const d = axisDomain([5, 5]);
    expect(d.max - d.min).toBe(MIN_SPAN);
  });

  it('clamps the low end at 0 and keeps the span', () => {
    expect(axisDomain([0, 1])).toEqual({ min: 0, max: 4 });
  });

  it('lets the high end pass 10', () => {
    expect(axisDomain([8, 10]).max).toBe(11);
  });
});

describe('canPlot', () => {
  it('needs three plotted strings for a map', () => {
    expect(canPlot(2)).toBe(false);
    expect(canPlot(3)).toBe(true);
  });
});

describe('dotPositions', () => {
  it('puts a higher rating higher and more durability further right', () => {
    const [weak, strong] = dotPositions([{ value: 5, durability: 5 }, { value: 9, durability: 8 }], W, H);
    expect(strong.y).toBeLessThan(weak.y);
    expect(strong.x).toBeGreaterThan(weak.x);
  });

  it('spreads strings on the same point 10px apart, in list order, around the point', () => {
    const items = [{ value: 8, durability: 6 }, { value: 8, durability: 6 }, { value: 8, durability: 6 }, { value: 5, durability: 9 }];
    const [a, b, c] = dotPositions(items, W, H);
    expect(b.x - a.x).toBe(SAME_POINT_SPREAD);
    expect(c.x - b.x).toBe(SAME_POINT_SPREAD);
    expect(a.y).toBe(b.y);
    // Centred: the middle one sits on the true point.
    const [solo] = dotPositions([{ value: 8, durability: 6 }, { value: 5, durability: 9 }], W, H);
    expect(b.x).toBeCloseTo(solo.x);
  });
});

describe('placeLabels', () => {
  // Five strings, four of them clustered — the BPM shelf's shape.
  const items = [
    { value: 9, durability: 6 },
    { value: 9, durability: 6.5 },
    { value: 8.5, durability: 6 },
    { value: 8, durability: 7 },
    { value: 6, durability: 9 },
  ];
  const dots = dotPositions(items, W, H);
  const widths = [60, 70, 90, 50, 80];

  for (const selected of [null, 0, 2, 4]) {
    it(`keeps every label inside the plot and clear of dots and labels (selected ${selected})`, () => {
      const placed = placeLabels({ dots, widths, labelHeight: 15, width: W, height: H, selected });
      const shown = placed.filter((p): p is NonNullable<typeof p> => p !== null);
      for (const r of shown) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(W);
        expect(r.y + r.h).toBeLessThanOrEqual(H);
      }
      shown.forEach((r, i) => shown.slice(i + 1).forEach((o) => expect(overlaps(r, o)).toBe(false)));
      placed.forEach((r, i) => {
        if (!r || i === selected) return;
        for (const d of dots) {
          expect(overlaps(r, { x: d.x - DOT_PX / 2, y: d.y - DOT_PX / 2, w: DOT_PX, h: DOT_PX })).toBe(false);
        }
      });
      if (selected !== null) expect(placed[selected]).not.toBeNull();
    });
  }

  it('hides a label with nowhere to go, but never the selected one', () => {
    // A plot too small for any label beside any dot.
    const tiny = dotPositions([{ value: 5, durability: 5 }, { value: 6, durability: 6 }, { value: 7, durability: 7 }], 40, 30);
    const placed = placeLabels({ dots: tiny, widths: [80, 80, 80], labelHeight: 15, width: 40, height: 30, selected: 1 });
    expect(placed[0]).toBeNull();
    expect(placed[2]).toBeNull();
    expect(placed[1]).not.toBeNull();
  });

  it('tries right of the dot first', () => {
    const placed = placeLabels({ dots: [{ x: 50, y: 100 }], widths: [40], labelHeight: 15, width: W, height: H, selected: null });
    expect(placed[0]?.side).toBe('right');
  });
});

describe('client safety', () => {
  it('lib/stringMap.ts imports nothing', () => {
    // The card is a client component; the geometry has to stay importable
    // there and testable here (client-server-import-canary walks the rest).
    const src = readFileSync(join(process.cwd(), 'lib', 'stringMap.ts'), 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});
