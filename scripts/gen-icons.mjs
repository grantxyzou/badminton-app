#!/usr/bin/env node
/**
 * Generate the PWA / home-screen icon set from the brand mark. Output →
 * public/icons/, app/icon.png and native/assets/.
 *
 *   node scripts/gen-icons.mjs        # web + native/assets sources
 *   npm run native:assets             # …then fans them out into ios/ + android/
 *
 * The mark is the SHUTTLE TRAJECTORY (`public/brand/bpm-trajectory.png`): a
 * green arc with the shuttle dropping at its end, rendered front-on from
 * `bpm-shuttle-trajectory-icon.glb` with the model's own tile and inner field
 * HIDDEN. That omission is the point — every platform draws its own shape
 * (iOS squircle, Android adaptive mask, the browser's favicon square), so a
 * tile baked into the pixels lands as a rounded rectangle inside a squircle,
 * with its own drop shadow cropped off-centre. The mark ships alone on
 * transparency and the ground is composited here, once, per output.
 *
 * It replaced the shuttlecock (`bpm-shuttlecock.png`, still in public/brand/)
 * on 2026-09-11 for legibility: at the 40px the OS actually draws in a folder
 * or a notification, the arc still reads as an arc, while the shuttlecock had
 * become a green blob by 60px.
 *
 * Composition: a soft charcoal radial-gradient tile (lighter center → near-black
 * brand edge) with the mark composited on top. There is no contact shadow — the
 * previous mark was a shuttlecock resting on the surface and needed one to lift
 * off a near-black ground; an arc touches nothing, and the render carries its
 * own shading.
 *
 * Outputs (all square PNG):
 *   app/icon.png              512  Next's file-convention favicon
 *   apple-touch-icon-180.png  180  iOS home screen (full-bleed; iOS rounds it)
 *   icon-192.png              192  manifest purpose:any
 *   icon-512.png              512  manifest purpose:any
 *   icon-maskable-512.png     512  manifest purpose:maskable (content in safe zone)
 *
 * Committed to the repo — they deploy via the existing `cp -r public` step in
 * the deploy workflow. Re-run if the brand mark or composition changes.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public/brand/bpm-trajectory.png');
const OUT = join(ROOT, 'public/icons');

mkdirSync(OUT, { recursive: true });

/**
 * How wide the mark is drawn, as a fraction of the icon's width.
 *
 * The mark is LANDSCAPE (about 1.3:1), so `fit: 'contain'` scales it to this
 * fraction of the width and roughly 0.77× that in height. The maskable number
 * is the binding one: a centred landscape box at ratio r has a half-diagonal of
 * 0.5·r·√(1 + 0.77²) ≈ 0.63·r, so the smallest circle containing it has
 * diameter ≈ 1.26·r. The maskable safe zone is a centred circle at 80% of the
 * icon, which caps r at 0.63 — 0.60 keeps a margin for the OEM masks that cut
 * tighter than the spec.
 */
const ANY_RATIO = 0.72;
const MASKABLE_RATIO = 0.6;

/** The tile: a charcoal radial gradient, lighter at the centre. */
function tileSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="78%">
      <stop offset="0%" stop-color="#2b2927"/>
      <stop offset="100%" stop-color="#100F0F"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" />
</svg>`);
}

/**
 * The mark, scaled to `contentRatio` of `size`, as a transparent square buffer.
 *
 * Every step below has to be its OWN sharp() call. A single pipeline applies
 * its operations in sharp's fixed order, not call order — resize runs before
 * extend, and flatten runs before composite — so chaining them reads correctly
 * and does something else. This file shipped a 1424px "1024px" foreground for
 * exactly that reason.
 */
async function markSquare(size, contentRatio) {
  const inner = Math.round(size * contentRatio);
  const mark = await sharp(SRC)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}

/* Flattened to RGB on purpose. Every output below is a full-bleed tile with
   nothing to see through, and Apple's App Store icon must carry no alpha
   channel at all — an all-opaque one still counts. */
async function make(size, contentRatio, outFile, dir = OUT) {
  const composed = await sharp(tileSvg(size))
    .composite([{ input: await markSquare(size, contentRatio), gravity: 'center' }])
    .png()
    .toBuffer();
  await sharp(composed)
    .flatten({ background: '#100F0F' })
    .png({ compressionLevel: 9 })
    .toFile(join(dir, outFile));
  console.log(`[gen-icons] wrote ${outFile} (${size}px, content ${Math.round(contentRatio * 100)}%)`);
}

await make(180, ANY_RATIO, 'apple-touch-icon-180.png');
await make(192, ANY_RATIO, 'icon-192.png');
await make(512, ANY_RATIO, 'icon-512.png');
await make(512, MASKABLE_RATIO, 'icon-maskable-512.png');

/* Next's file convention: app/icon.png becomes the favicon link. Square and
   regenerated here so it cannot drift from the set above — it used to be the
   raw 942×1021 shuttlecock, which is neither square nor the current mark. */
await make(512, ANY_RATIO, 'icon.png', join(ROOT, 'app'));
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

await make(1024, ANY_RATIO, 'icon.png', NATIVE);
await sharp(tileSvg(1024)).flatten({ background: '#100F0F' }).png().toFile(join(NATIVE, 'icon-background.png'));

/**
 * The Android adaptive FOREGROUND, transparent, mark centred.
 *
 * How much of it is safe depends on this project's `ic_launcher.xml`, which
 * wraps both layers in `<inset android:inset="16.7%">`: the bitmap is drawn
 * into the central 72dp of the 108dp canvas rather than filling it, so the
 * 66dp guaranteed-visible circle is 66/72 = 92% of the BITMAP, not 61% of it.
 * A landscape mark at ratio r needs 1.26·r ≤ 0.92, so r ≤ 0.73. If that inset
 * is ever dropped from the XML, this has to fall to 0.48.
 */
const ADAPTIVE_RATIO = 0.7;
await sharp(await markSquare(1024, ADAPTIVE_RATIO)).toFile(join(NATIVE, 'icon-foreground.png'));

// A launch screen is mostly ground: the mark is small so it does not read as
// a second, bigger icon.
await make(2732, 0.18, 'splash.png', NATIVE);
await make(2732, 0.18, 'splash-dark.png', NATIVE);
console.log('[gen-icons] native done →', NATIVE);
