import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Nothing animates a property the compositor cannot take.
 *
 * `backdrop-filter` re-samples the whole backdrop per frame and `font-size`
 * relayouts and re-rasterises text per frame; both were on the two headers
 * that condense DURING SCROLL, which is the one moment the main thread has
 * nothing spare. jsdom computes no styles, so a source scan is the only
 * thing that can see this come back.
 */
const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const BANNED = ['backdrop-filter', 'font-size'];

describe('no transition animates a main-thread-only property', () => {
  const declarations = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]);

  for (const prop of BANNED) {
    it(`nothing transitions ${prop}`, () => {
      const offenders = declarations.filter((d) => new RegExp(`(^|[,\\s])${prop}[\\s,]`).test(d));
      expect(offenders, `transition on ${prop}: ${offenders.join(' | ')}`).toEqual([]);
    });
  }
});
