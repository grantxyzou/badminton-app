import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The fit page's grip circles are the handle seen end-on, TO SCALE. The handoff
 * calls two declarations load-bearing — `flex: 0 0 auto` and
 * `box-sizing: border-box` — because without them the circles squash to ovals
 * and the border inflates the small sizes. jsdom applies no stylesheet, so
 * this is a source check.
 */
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
}

describe('fit grip circles', () => {
  it('keep their size inside the tile', () => {
    const base = rule('.fit-grip-circle');
    expect(base).toContain('box-sizing: border-box');
    expect(base).toContain('flex: 0 0 auto');
  });

  it('are drawn at 44 / 38 / 32 / 26 px', () => {
    for (const [g, px] of [['G3', 44], ['G4', 38], ['G5', 32], ['G6', 26]] as const) {
      const r = rule(`.fit-grip-circle--${g}`);
      expect(r).toContain(`width: ${px}px`);
      expect(r).toContain(`height: ${px}px`);
    }
  });
});
