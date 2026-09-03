#!/usr/bin/env node
/**
 * Generate the PWA / home-screen icon set from the brand shuttlecock. Output →
 * public/icons/.
 *
 *   node scripts/gen-icons.mjs
 *
 * Composition: a soft charcoal radial-gradient tile (lighter center → near-black
 * brand edge) + a strong, blurred dark contact shadow beneath the shuttlecock
 * (so it reads as lifted off the surface — a plain dark shadow is invisible on
 * the near-black brand bg, hence the lighter tile), with the shuttlecock raster
 * composited on top.
 *
 * Outputs (all square PNG):
 *   apple-touch-icon-180.png  180  iOS home screen (full-bleed; iOS rounds it)
 *   icon-192.png              192  manifest purpose:any
 *   icon-512.png              512  manifest purpose:any
 *   icon-maskable-512.png     512  manifest purpose:maskable (content in safe zone)
 *
 * Committed to the repo — they deploy via the existing `cp -r public` step in
 * both deploy workflows. Re-run if the brand mark or composition changes.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public/brand/bpm-shuttlecock.png');
const OUT = join(ROOT, 'public/icons');

mkdirSync(OUT, { recursive: true });

/**
 * The tile: charcoal radial gradient + a blurred dark contact-shadow ellipse
 * sitting just under where the (centered) shuttlecock meets the surface.
 */
function tileSvg(size) {
  const cx = size * 0.5;
  const shadowCy = size * 0.72;
  const rx = size * 0.24;
  const ry = size * 0.055;
  const blur = size * 0.018;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#2b2927"/>
      <stop offset="100%" stop-color="#100F0F"/>
    </radialGradient>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${blur}" />
    </filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" />
  <ellipse cx="${cx}" cy="${shadowCy}" rx="${rx}" ry="${ry}" fill="#000000" fill-opacity="0.6" filter="url(#soft)" />
</svg>`);
}

/**
 * Render one square icon: tile (gradient + contact shadow) with the shuttlecock
 * scaled to `contentRatio` of the tile, centered. `contentRatio` is smaller for
 * maskable icons so the mark survives Android's circular/squircle mask.
 */
async function make(size, contentRatio, outFile) {
  const inner = Math.round(size * contentRatio);
  const fg = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(tileSvg(size))
    .composite([{ input: fg, gravity: 'center' }])
    .png()
    .toFile(join(OUT, outFile));
  console.log(`[gen-icons] wrote ${outFile} (${size}px, content ${Math.round(contentRatio * 100)}%)`);
}

await make(180, 0.7, 'apple-touch-icon-180.png');
await make(192, 0.7, 'icon-192.png');
await make(512, 0.7, 'icon-512.png');
await make(512, 0.6, 'icon-maskable-512.png');
console.log('[gen-icons] done →', OUT);

/**
 * Native store assets → native/assets/, the input `@capacitor/assets` expects:
 *   icon.png          1024  App Store icon (opaque — the tile has no alpha) +
 *                           the source for every iOS/Android size
 *   icon-foreground   1024  Android adaptive foreground (mark only, transparent)
 *   icon-background   1024  Android adaptive background (tile only)
 *   splash.png        2732  launch screen, mark centred on the tile
 *   splash-dark.png   2732  same — the brand ground is dark in both themes
 * Then: npx @capacitor/assets generate --assetPath native/assets
 */
const NATIVE = join(ROOT, 'native/assets');
mkdirSync(NATIVE, { recursive: true });

async function makeNative(size, contentRatio, outFile) {
  const inner = Math.round(size * contentRatio);
  const fg = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp(tileSvg(size)).composite([{ input: fg, gravity: 'center' }]).png().toFile(join(NATIVE, outFile));
  console.log(`[gen-icons] wrote native/${outFile} (${size}px)`);
}

await makeNative(1024, 0.7, 'icon.png');
await sharp(tileSvg(1024)).png().toFile(join(NATIVE, 'icon-background.png'));
await sharp(SRC)
  .resize(Math.round(1024 * 0.55), Math.round(1024 * 0.55), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 230, bottom: 230, left: 230, right: 230, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .resize(1024, 1024)
  .png()
  .toFile(join(NATIVE, 'icon-foreground.png'));
// A launch screen is mostly ground: the mark is small so it does not read as
// a second, bigger icon.
await makeNative(2732, 0.18, 'splash.png');
await makeNative(2732, 0.18, 'splash-dark.png');
console.log('[gen-icons] native done →', NATIVE);
