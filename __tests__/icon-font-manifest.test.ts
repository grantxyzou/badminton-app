import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { iconNames, iconNamesHash } from '../scripts/fetch-icon-font.mjs';

/**
 * The icon font IS the glyph list — a subset built from exactly those names.
 * Add a name without rebuilding and that glyph renders as its own word at
 * runtime ("expand_less"), which nothing else in the suite can see: the list
 * check passes (the name is there) and the font file is never read.
 */
describe('the icon font matches lib/iconNames.ts', () => {
  const font = join(process.cwd(), 'app', 'fonts', 'MaterialSymbolsRounded-Subset.woff2');
  const manifest = join(process.cwd(), 'app', 'fonts', 'material-symbols.manifest.json');

  it('the subset is built and not empty', () => {
    expect(existsSync(font), 'run: node scripts/fetch-icon-font.mjs').toBe(true);
    expect(statSync(font).size).toBeGreaterThan(2000);
  });

  it('it was built from the CURRENT list', () => {
    const names = iconNames();
    const built = JSON.parse(readFileSync(manifest, 'utf8'));
    expect(names.length).toBeGreaterThan(0);
    expect(
      built.namesHash,
      `lib/iconNames.ts has changed since the font was built (${names.length} glyphs now, ${built.glyphs} in the font). Run: node scripts/fetch-icon-font.mjs`,
    ).toBe(iconNamesHash(names));
  });

  it('nothing loads a font from a third party any more', () => {
    const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');
    expect(layout, 'a stylesheet in <head> blocks first paint').not.toMatch(/fonts\.googleapis\.com"/);
  });
});
