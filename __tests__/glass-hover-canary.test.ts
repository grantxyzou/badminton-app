import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Grant, 2026-09-14: "the cards they move and shine when mouse hover on it.
 * weird" → "all cards should have liquid glass type but maybe do not track
 * mouse". Two rules, both invisible to jsdom (it applies no stylesheet and
 * fires no mousemove), so they are pinned by reading the source.
 */
const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

describe('glass hover canary', () => {
  it('only a pressable card reacts to hover — no bare .glass-card:hover or .cc-dcard:hover', () => {
    const bare = css
      .split('\n')
      .filter((line) => /(^|[\s,])\.(glass-card|cc-dcard):hover/.test(line));
    expect(bare).toEqual([]);
  });

  it('nothing tracks the pointer to move the glass highlight', () => {
    expect(existsSync(join(process.cwd(), 'components/GlassPhysics.tsx'))).toBe(false);
    const shell = readFileSync(join(process.cwd(), 'components/HomeShell.tsx'), 'utf8');
    expect(shell).not.toMatch(/setProperty\(\s*'--m[xy]'/);
    expect(shell).not.toMatch(/GlassPhysics/);
  });
});
