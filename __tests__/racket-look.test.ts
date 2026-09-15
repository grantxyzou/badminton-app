import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import catalogSeed from '../scripts/data/equipment-catalog.json';
import { DEFAULT_LOOK, RACKET_LOOKS, racketLook, racketSrc } from '../lib/racketLook';
import { PATTERNS, SHAPES } from '../lib/racketModel';

type Row = { id: string; category: string };
const rows = (Array.isArray(catalogSeed) ? catalogSeed : Object.values(catalogSeed).flat()) as Row[];
const rackets = rows.filter((r) => r.category === 'racket').map((r) => r.id);
const IMAGES = join(process.cwd(), 'public', 'rackets');

describe('racket looks', () => {
  it('every catalog racket has a look, and no look names a racket the catalog lacks', () => {
    // A new catalog racket would otherwise render in the default colours with
    // no one noticing; a renamed id would silently lose its paint.
    expect(rackets.filter((id) => !RACKET_LOOKS[id])).toEqual([]);
    expect(Object.keys(RACKET_LOOKS).filter((id) => !rackets.includes(id))).toEqual([]);
  });

  it('every colour is a #rrggbb the model can paint and darken', () => {
    const bad = Object.entries(RACKET_LOOKS).flatMap(([id, look]) =>
      [look.frame, look.accent, look.grip].filter((c) => !/^#[0-9a-f]{6}$/.test(c)).map((c) => `${id} ${c}`));
    expect(bad).toEqual([]);
  });

  it('every paint pattern and head shape a look names exists on the model', () => {
    const bad = Object.entries(RACKET_LOOKS).flatMap(([id, look]) => [
      ...(look.pattern && !(look.pattern in PATTERNS) ? [`${id} pattern ${look.pattern}`] : []),
      ...(look.shape && !(look.shape in SHAPES) ? [`${id} shape ${look.shape}`] : []),
    ]);
    expect(bad).toEqual([]);
  });

  it('a racket with no catalog id, or one the table does not know, uses the default', () => {
    expect(racketLook(null)).toBe(DEFAULT_LOOK);
    expect(racketLook('racket-nobody-makes-this')).toBe(DEFAULT_LOOK);
    expect(racketSrc('racket-nobody-makes-this')).toBe(racketSrc(undefined));
    expect(racketSrc(null)).toMatch(/\/rackets\/_default\.webp$/);
  });
});

describe('pre-rendered racket images', () => {
  // Re-run `node scripts/render-racket-images.mjs` against a dev server when
  // either of these fails: the images are rendered from the 3D model, never
  // drawn by hand, so a look without an image is a render that was not run.
  it('every look, and the default, has an image', () => {
    const missing = ['_default', ...Object.keys(RACKET_LOOKS)].filter((id) => !existsSync(join(IMAGES, `${id}.webp`)));
    expect(missing).toEqual([]);
  });

  it('no image is left behind for a racket the table no longer has', () => {
    const known = new Set(['_default', ...Object.keys(RACKET_LOOKS)]);
    const stray = readdirSync(IMAGES).filter((f) => f.endsWith('.webp') && !known.has(f.replace(/\.webp$/, '')));
    expect(stray).toEqual([]);
  });

  it('points at the same-origin file for a known racket', () => {
    expect(racketSrc('racket-yonex-astrox-88s-pro')).toMatch(/\/rackets\/racket-yonex-astrox-88s-pro\.webp$/);
  });
});
