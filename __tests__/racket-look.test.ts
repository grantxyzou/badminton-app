import { describe, expect, it } from 'vitest';
import catalogSeed from '../scripts/data/equipment-catalog.json';
import { DEFAULT_LOOK, RACKET_LOOKS, racketLook, racketSrc, racketSvg } from '../lib/racketLook';

type Row = { id: string; category: string };
const rows = (Array.isArray(catalogSeed) ? catalogSeed : Object.values(catalogSeed).flat()) as Row[];
const rackets = rows.filter((r) => r.category === 'racket').map((r) => r.id);

describe('racket looks', () => {
  it('every catalog racket has a look, and no look names a racket the catalog lacks', () => {
    // A new catalog racket would otherwise draw in the default colours with no
    // one noticing; a renamed id would silently lose its paint.
    expect(rackets.filter((id) => !RACKET_LOOKS[id])).toEqual([]);
    expect(Object.keys(RACKET_LOOKS).filter((id) => !rackets.includes(id))).toEqual([]);
  });

  it('every colour is a #rrggbb the renderer can darken', () => {
    const bad = Object.entries(RACKET_LOOKS).flatMap(([id, look]) =>
      [look.frame, look.accent, look.grip].filter((c) => !/^#[0-9a-f]{6}$/.test(c)).map((c) => `${id} ${c}`));
    expect(bad).toEqual([]);
  });

  it('paints the drawing in the model\'s colours', () => {
    const look = RACKET_LOOKS['racket-li-ning-halbertec-8000'];
    const svg = racketSvg(look);
    expect(svg).toContain(`stroke="${look.frame}"`);
    expect(svg).toContain(`fill="${look.accent}"`);
    expect(svg).toContain(`fill="${look.grip}"`);
  });

  it('a racket with no catalog id, or one the table does not know, draws the default', () => {
    expect(racketLook(null)).toBe(DEFAULT_LOOK);
    expect(racketLook('racket-nobody-makes-this')).toBe(DEFAULT_LOOK);
    expect(racketSrc('racket-nobody-makes-this')).toBe(racketSrc(undefined));
  });

  it('is a data URL, which next.config.js img-src allows', () => {
    expect(racketSrc('racket-yonex-astrox-88s-pro')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(racketSrc('racket-yonex-astrox-88s-pro')).not.toBe(racketSrc(null));
  });
});
