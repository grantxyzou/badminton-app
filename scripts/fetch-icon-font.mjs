#!/usr/bin/env node
/**
 * Build the icon font from `lib/iconNames.ts`.
 *
 * Material Symbols was the one face still loaded from Google at runtime, and a
 * stylesheet in `<head>` BLOCKS first paint: two hops (googleapis for the CSS,
 * gstatic for the woff2) before anything renders, on a phone, on the app's
 * first screen. Every other face here has been self-hosted since 2026-09-07
 * for the same reason (`docs/subset-fonts.md`).
 *
 * The subset is built from the exact glyph list, so this has to re-run whenever
 * that list changes — `__tests__/icon-font-manifest.test.ts` fails with this
 * command in the message when it doesn't.
 *
 *   node scripts/fetch-icon-font.mjs
 *
 * `display=block` rather than `swap`: a Material Symbols glyph is a LIGATURE,
 * so the fallback paints the glyph's NAME ("expand_less") as text. Blank for a
 * moment beats a word where an icon goes.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = join(ROOT, 'app', 'fonts', 'MaterialSymbolsRounded-Subset.woff2');
const MANIFEST = join(ROOT, 'app', 'fonts', 'material-symbols.manifest.json');

// A modern desktop UA: Google serves woff2 to it and .ttf to anything it does
// not recognise, and the .ttf is several times the size.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function iconNames() {
  const source = readFileSync(join(ROOT, 'lib', 'iconNames.ts'), 'utf8');
  const body = source.slice(source.indexOf('ICON_NAMES = ['));
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

/** The names are what the subset IS, so the hash is over them, sorted. */
export function iconNamesHash(names) {
  return createHash('sha256').update([...names].sort().join(',')).digest('hex').slice(0, 16);
}

async function main() {
  const names = iconNames();
  if (names.length === 0) throw new Error('lib/iconNames.ts lists no glyphs');
  const url = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=${names.join(',')}&display=block`;

  const cssRes = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!cssRes.ok) throw new Error(`Google answered ${cssRes.status} for the subset CSS`);
  const css = await cssRes.text();
  // The subset URL carries no extension (`/l/font?kit=…`), so the format()
  // marker is what says which face it is.
  const fontUrl = css.match(/url\((https:\/\/[^)]+)\)\s*format\('woff2'\)/)?.[1];
  if (!fontUrl) throw new Error('no woff2 in the stylesheet — did the UA get a ttf?');

  const fontRes = await fetch(fontUrl, { headers: { 'User-Agent': UA } });
  if (!fontRes.ok) throw new Error(`Google answered ${fontRes.status} for the woff2`);
  const bytes = Buffer.from(await fontRes.arrayBuffer());
  writeFileSync(FONT, bytes);
  writeFileSync(MANIFEST, `${JSON.stringify({
    glyphs: names.length,
    namesHash: iconNamesHash(names),
    bytes: bytes.length,
    fetchedAt: new Date().toISOString().slice(0, 10),
  }, null, 2)}\n`);
  console.log(`icon font: ${names.length} glyphs, ${(bytes.length / 1024).toFixed(1)} KB → app/fonts/MaterialSymbolsRounded-Subset.woff2`);
}

if (process.argv[1] && process.argv[1].endsWith('fetch-icon-font.mjs')) {
  main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
