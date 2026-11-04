import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  foldFromSegments,
  foldFromNative,
  readWebFold,
  splitForFold,
  subscribeFold,
  UNKNOWN_FOLD,
  type FoldInfo,
} from '../lib/fold';

/**
 * `lib/fold.ts` is the one owner of "where is the fold?" for the courtside
 * scoreboard (docs/plans/foldable-layout.md, step 3). Three sources, one
 * shape, and the rule that matters most: UNKNOWN IS NOT FLAT. A source that
 * cannot say leaves `posture` null, and the split falls back to the centre of
 * the screen, where every fold is.
 */
// Node's own `globalThis.navigator` is getter-only, so the browser globals
// are stubbed through vitest rather than assigned.
const g = {
  set window(v: unknown) {
    vi.stubGlobal('window', v);
  },
  set navigator(v: unknown) {
    vi.stubGlobal('navigator', v);
  },
};
const noWindow = () => vi.stubGlobal('window', undefined);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('foldFromSegments', () => {
  it('two segments side by side → a vertical fold between them', () => {
    const fold = foldFromSegments([
      { left: 0, top: 0, right: 460, bottom: 900 },
      { left: 490, top: 0, right: 950, bottom: 900 },
    ]);
    expect(fold).toEqual({ x: 460, y: 0, width: 30, height: 900 });
  });

  it('two segments stacked → a horizontal fold between them, whatever order they come in', () => {
    const fold = foldFromSegments([
      { left: 0, top: 470, right: 900, bottom: 950 },
      { left: 0, top: 0, right: 900, bottom: 440 },
    ]);
    expect(fold).toEqual({ x: 0, y: 440, width: 900, height: 30 });
  });

  it('one segment, three segments, or nothing is no fold', () => {
    expect(foldFromSegments([{ left: 0, top: 0, right: 400, bottom: 800 }])).toBeNull();
    expect(foldFromSegments([])).toBeNull();
    expect(foldFromSegments(null)).toBeNull();
    expect(foldFromSegments(undefined)).toBeNull();
  });

  it('a segment with a non-number edge is no fold', () => {
    expect(
      foldFromSegments([
        { left: 0, top: 0, right: Number.NaN, bottom: 900 },
        { left: 490, top: 0, right: 950, bottom: 900 },
      ]),
    ).toBeNull();
  });
});

describe('foldFromNative', () => {
  it('folded with a rect', () => {
    const info = foldFromNative({ posture: 'folded', fold: { x: 0, y: 300, width: 700, height: 24 } });
    expect(info).toEqual<FoldInfo>({
      posture: 'folded',
      fold: { x: 0, y: 300, width: 700, height: 24 },
      axis: 'horizontal',
      source: 'native',
    });
  });

  it('a tall rect runs vertically (book pose)', () => {
    expect(foldFromNative({ posture: 'folded', fold: { x: 460, y: 0, width: 30, height: 900 } }).axis).toBe('vertical');
  });

  it('flat carries no rect even when one is sent', () => {
    const info = foldFromNative({ posture: 'flat', fold: { x: 0, y: 300, width: 700, height: 24 } });
    expect(info).toEqual<FoldInfo>({ posture: 'flat', fold: null, axis: null, source: 'native' });
  });

  it('folded with a broken rect is folded with no rect, never NaN', () => {
    const info = foldFromNative({ posture: 'folded', fold: { x: 0, y: 'three hundred', width: 700, height: 24 } });
    expect(info.posture).toBe('folded');
    expect(info.fold).toBeNull();
    expect(info.axis).toBeNull();
  });

  it('"unknown" (iOS before 27), junk and nothing are all unknown', () => {
    expect(foldFromNative({ posture: 'unknown' })).toEqual(UNKNOWN_FOLD);
    expect(foldFromNative({ posture: 'sideways' })).toEqual(UNKNOWN_FOLD);
    expect(foldFromNative(null)).toEqual(UNKNOWN_FOLD);
    expect(foldFromNative('folded')).toEqual(UNKNOWN_FOLD);
  });
});

describe('readWebFold', () => {
  it('is unknown with no posture API and no segments', () => {
    g.window = {};
    g.navigator = {};
    expect(readWebFold()).toEqual(UNKNOWN_FOLD);
  });

  it('reads folded from the posture API and the fold from the segments', () => {
    g.navigator = { devicePosture: { type: 'folded' } };
    g.window = {
      viewport: {
        segments: [
          { left: 0, top: 0, right: 900, bottom: 440 },
          { left: 0, top: 470, right: 900, bottom: 950 },
        ],
      },
    };
    expect(readWebFold()).toEqual<FoldInfo>({
      posture: 'folded',
      fold: { x: 0, y: 440, width: 900, height: 30 },
      axis: 'horizontal',
      source: 'web',
    });
  });

  it('"continuous" is flat, and a flat device reports no fold', () => {
    g.navigator = { devicePosture: { type: 'continuous' } };
    g.window = { viewport: { segments: [{ left: 0, top: 0, right: 900, bottom: 950 }] } };
    expect(readWebFold()).toEqual<FoldInfo>({ posture: 'flat', fold: null, axis: null, source: 'web' });
  });
});

describe('splitForFold', () => {
  it('splits at a horizontal fold: board above, controls below', () => {
    const info: FoldInfo = { posture: 'folded', fold: { x: 0, y: 440, width: 900, height: 30 }, axis: 'horizontal', source: 'web' };
    expect(splitForFold(info, 900, 950)).toEqual({ axis: 'horizontal', first: 440, gap: 30, second: 480 });
  });

  it('splits at a vertical fold: board left, controls right', () => {
    const info: FoldInfo = { posture: 'folded', fold: { x: 460, y: 0, width: 30, height: 900 }, axis: 'vertical', source: 'native' };
    expect(splitForFold(info, 950, 900)).toEqual({ axis: 'vertical', first: 460, gap: 30, second: 460 });
  });

  it('unknown falls back to the centre — across in portrait, down the middle in landscape', () => {
    expect(splitForFold(UNKNOWN_FOLD, 430, 932)).toEqual({ axis: 'horizontal', first: 466, gap: 0, second: 466 });
    expect(splitForFold(UNKNOWN_FOLD, 951, 620)).toEqual({ axis: 'vertical', first: 475, gap: 0, second: 476 });
  });

  it('a fold at the very edge of the viewport is not a split', () => {
    const info: FoldInfo = { posture: 'folded', fold: { x: 0, y: 0, width: 900, height: 30 }, axis: 'horizontal', source: 'web' };
    expect(splitForFold(info, 900, 950)).toEqual({ axis: 'horizontal', first: 475, gap: 0, second: 475 });
  });
});

describe('subscribeFold', () => {
  it('on the web, answers at once from the posture API and again on change', () => {
    const listeners: Array<() => void> = [];
    const posture = {
      type: 'continuous',
      addEventListener: (_: 'change', cb: () => void) => {
        listeners.push(cb);
      },
      removeEventListener: (_: 'change', cb: () => void) => {
        listeners.splice(listeners.indexOf(cb), 1);
      },
    };
    g.navigator = { devicePosture: posture };
    g.window = { addEventListener: () => {}, removeEventListener: () => {} };
    const seen: FoldInfo[] = [];
    const stop = subscribeFold((i) => seen.push(i));
    expect(seen).toHaveLength(1);
    expect(seen[0].posture).toBe('flat');
    posture.type = 'folded';
    listeners.forEach((cb) => cb());
    expect(seen).toHaveLength(2);
    expect(seen[1].posture).toBe('folded');
    stop();
    expect(listeners).toHaveLength(0);
  });

  it('during SSR, subscribes to nothing and never calls back', () => {
    noWindow();
    const seen: FoldInfo[] = [];
    const stop = subscribeFold((i) => seen.push(i));
    stop();
    expect(seen).toEqual([]);
  });
});
