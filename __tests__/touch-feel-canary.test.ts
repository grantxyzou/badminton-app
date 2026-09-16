import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The touch contract, as a source scan — jsdom computes every length as 0px,
 * so no rendering test can see any of this.
 */
const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
/** Comments stripped: a selector list is parsed below, and a comment above a
 *  rule is part of neither. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('fields do not zoom the page on iOS', () => {
  it('a coarse pointer gets 16px fields', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(coarse, 'no coarse-pointer block').not.toBe('');
    expect(coarse).toMatch(/input,\s*\n\s*select,\s*\n\s*textarea\s*{\s*font-size:\s*16px/);
  });
});

describe('every tappable family answers a tap', () => {
  // The four that answered with nothing but WebKit's grey flash.
  const families = ['button.sheet-row', 'button.setup-line', '.bpm-row-link', '.rail-tab'];
  for (const sel of families) {
    it(`${sel} has a press state`, () => {
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(css, `${sel} has no :active rule`).toMatch(new RegExp(`${escaped}:active`));
    });
    it(`${sel} is in a rule that suppresses the default tap highlight`, () => {
      // The selector list of every rule that sets the property, parsed rather
      // than sniffed: "somewhere above it in the file" would pass on any file.
      const lists = [...bare.matchAll(/([^{}]+){[^{}]*-webkit-tap-highlight-color:\s*transparent[^{}]*}/g)]
        .map((m) => m[1].split(',').map((x) => x.trim()));
      expect(lists.some((l) => l.includes(sel)), `${sel} still flashes WebKit grey`).toBe(true);
    });
  }
});

describe('a sheet keeps its own scroll', () => {
  it('the sheet body contains its overscroll', () => {
    const body = readFileSync(join(process.cwd(), 'components', 'BottomSheet', 'BottomSheetBody.tsx'), 'utf8');
    expect(body).toContain('overscroll-contain');
  });
});
