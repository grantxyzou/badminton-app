#!/usr/bin/env node
/**
 * Draw the six birdie avatars (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §2):
 * the app icon's shuttle, refined rather than realistic — a smooth white skirt,
 * a coloured rim and five spines, a ridged collar and a round cork — tilted in
 * flight on a pale ground of its own colour.
 *
 *   node scripts/make-birdie-avatars.mjs
 *
 * Writes `public/brand/birdies/<colour>.webp`, 256 px square, FLATTENED onto the
 * ground (the circle around it is cut by `.member-avatar`'s border-radius), so
 * the file carries its own background and the app needs no colour table: the
 * paint lives here, once. 256 px covers Edit profile's 112 px circle on a 2×
 * screen; a roster circle (≤ 48 px) uses the same file.
 *
 * Pre-rendered, never drawn live, like the racket pictures. The colours come
 * from Grant's mock-up (2026-11-09: "I like my logo icon more … refine but not
 * realistic"). `__tests__/birdie-avatar-images.test.ts` fails until every colour
 * in `BIRDIE_COLOURS` (`lib/memberAvatar.ts`) has its file.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Rim colour, its highlight, and the pale ground behind the shuttle. */
const PAINT = {
  green: { rim: '#1fa64a', hi: '#a7f0bf', ground: '#dcf2e3' },
  yellow: { rim: '#f0b400', hi: '#fff0a6', ground: '#fdf3c4' },
  pink: { rim: '#ec4f93', hi: '#ffc2dc', ground: '#fde4ef' },
  blue: { rim: '#2c6fe4', hi: '#b9d3ff', ground: '#dce8fc' },
  purple: { rim: '#7a49dc', hi: '#d7c7ff', ground: '#ebe3fc' },
  orange: { rim: '#f26a14', hi: '#ffd1b0', ground: '#fde5d3' },
};

const SIZE = 256;
const CX = 200, TOP_Y = 92, RX = 118, RY = 30;
const WY = 262, WRX = 44, WRY = 11;

function shuttle({ rim, hi }) {
  const spines = [-62, -31, 0, 31, 62].map((deg) => {
    const t = (deg * Math.PI) / 180;
    const x1 = CX + RX * Math.sin(t), y1 = TOP_Y + RY * Math.cos(t);
    const x2 = CX + WRX * Math.sin(t), y2 = WY + WRY * Math.cos(t);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${rim}" stroke-width="7" stroke-linecap="round"/>`
      + `<path d="M${(x1 - 1.5).toFixed(1)} ${y1.toFixed(1)} L${(x2 - 1.2).toFixed(1)} ${y2.toFixed(1)}" stroke="${hi}" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
  }).join('');
  return `
<defs>
  <linearGradient id="skirt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e3e6ea"/><stop offset=".32" stop-color="#ffffff"/><stop offset=".62" stop-color="#f3f4f6"/><stop offset="1" stop-color="#c3c8cf"/></linearGradient>
  <linearGradient id="inside" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bec6"/><stop offset="1" stop-color="#dfe2e6"/></linearGradient>
  <linearGradient id="waist" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d4d8dd"/><stop offset=".35" stop-color="#ffffff"/><stop offset="1" stop-color="#b8bec6"/></linearGradient>
  <radialGradient id="cork" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#eef0f2"/><stop offset="1" stop-color="#b9bfc7"/></radialGradient>
</defs>
<ellipse cx="${CX}" cy="${TOP_Y}" rx="${RX}" ry="${RY}" fill="url(#inside)"/>
<path d="M${CX - RX} ${TOP_Y} L${CX - WRX} ${WY} A${WRX} ${WRY} 0 0 0 ${CX + WRX} ${WY} L${CX + RX} ${TOP_Y} A${RX} ${RY} 0 0 1 ${CX - RX} ${TOP_Y} Z" fill="url(#skirt)"/>
${spines}
<ellipse cx="${CX}" cy="${TOP_Y}" rx="${RX}" ry="${RY}" fill="none" stroke="${rim}" stroke-width="11"/>
<path d="M${CX - RX + 6} ${TOP_Y - 3} A${RX - 6} ${RY - 4} 0 0 1 ${CX + RX - 30} ${TOP_Y - 22}" fill="none" stroke="${hi}" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
<circle cx="${CX}" cy="${WY + 44}" r="46" fill="url(#cork)"/>
<path d="M${CX - WRX - 2} ${WY - 4} A${WRX + 2} ${WRY} 0 0 0 ${CX + WRX + 2} ${WY - 4} L${CX + WRX + 2} ${WY + 16} A${WRX + 2} ${WRY} 0 0 1 ${CX - WRX - 2} ${WY + 16} Z" fill="url(#waist)"/>
<path d="M${CX - WRX - 2} ${WY + 4} A${WRX + 2} ${WRY} 0 0 0 ${CX + WRX + 2} ${WY + 4}" fill="none" stroke="#aab1ba" stroke-width="1.4" opacity=".7"/>
<path d="M${CX - WRX - 2} ${WY + 11} A${WRX + 2} ${WRY} 0 0 0 ${CX + WRX + 2} ${WY + 11}" fill="none" stroke="#aab1ba" stroke-width="1.4" opacity=".7"/>
<ellipse cx="${CX - 15}" cy="${WY + 40}" rx="10" ry="13" fill="#ffffff" opacity=".75"/>`;
}

/**
 * The shuttle spans y 62..352 in its own 400-unit box. Tilted 30° in flight
 * about its middle and scaled to fill most of the square, with a soft shadow below.
 */
function avatarSvg(paint) {
  const scale = 0.92;
  const body = shuttle(paint);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="${SIZE}" height="${SIZE}">
<rect width="400" height="400" fill="${paint.ground}"/>
<defs><filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter></defs>
<g transform="translate(214 222) rotate(30) scale(${scale}) translate(-200 -207)" opacity=".22" filter="url(#soft)">
  <path d="M82 92 L156 262 A44 30 0 0 0 244 262 L318 92 A118 30 0 0 1 82 92 Z" fill="#000"/>
  <circle cx="200" cy="306" r="46" fill="#000"/>
</g>
<g transform="translate(200 204) rotate(30) scale(${scale}) translate(-200 -207)">${body}</g>
</svg>`;
}

const out = join(process.cwd(), 'public', 'brand', 'birdies');
mkdirSync(out, { recursive: true });
for (const [colour, paint] of Object.entries(PAINT)) {
  await sharp(Buffer.from(avatarSvg(paint)))
    .flatten({ background: paint.ground })
    .webp({ quality: 86, effort: 6 })
    .toFile(join(out, `${colour}.webp`));
}
console.log(`wrote ${Object.keys(PAINT).length} birdies to public/brand/birdies/`);
