/**
 * A catalog string's retail packet, drawn from data (`docs/plans/string-packets.md`).
 *
 * The string's picture on the Stringing tab is its 10 m retail packet, the way
 * the racket's is its frame: matched to maker and retailer photos, painted
 * flat — card colours, stripes and panels, the model's name, the clear window
 * and the coil of string behind it, the hang header — and pre-rendered to
 * `public/strings/<id>.webp` by `scripts/render-string-images.mjs`. The maker's
 * logo is left off on purpose; the model name is set in plain type.
 *
 * COORDINATES are fractions of the card: x 0 (left) to 1 (right), y 0 (top) to
 * 1 (bottom). SIZES (text, the coil's radius) are fractions of the card's WIDTH.
 *
 * `drawStringPack` takes a 2D canvas context, so it runs wherever a canvas
 * does (the dev-only render page, the research harness); nothing in the app
 * draws a packet live.
 */

import { sampleStops, type RGB, type Stops } from './racketLivery';

export interface PackShape {
  /** A polygon, in card fractions, clockwise or not. */
  points: ReadonlyArray<readonly [number, number]>;
  /** One colour, or stops running top (0) to bottom (1) of the CARD. */
  colour: Stops;
}

export interface PackText {
  text: string;
  x: number;
  y: number;
  /** Cap height, as a fraction of the card's width. */
  size: number;
  colour: string;
  weight?: 400 | 700 | 900;
  align?: 'left' | 'center' | 'right';
  italic?: boolean;
  /** Degrees, clockwise; -90 runs the text up a side stripe. */
  rotate?: number;
  /** Horizontal stretch: 1.3 for the wide display faces makers use. */
  scaleX?: number;
}

export interface StringPack {
  /** Where the reference photos came from (a domain). */
  source: string;
  /** The card's height ÷ width (a Yonex 10 m packet is about 1.3). */
  aspect: number;
  /** The card, top (0) to bottom (1). */
  base: Stops;
  shapes?: readonly PackShape[];
  /** Horizontal rules across the card: the perforation under the header, a printed line. */
  lines?: ReadonlyArray<{ y: number; colour: string; dashed?: boolean; width?: number; x0?: number; x1?: number }>;
  /** Ovals and dots: a sticker, a printed disc. Radii are fractions of the card's width. */
  ellipses?: ReadonlyArray<{ cx: number; cy: number; rx: number; ry?: number; colour: string }>;
  texts?: readonly PackText[];
  /** Small rating bars, as the Yonex packets print them: a row of `of` cells, `filled` of them lit. */
  meters?: ReadonlyArray<{ x: number; y: number; w: number; filled: number; of: number; on: string; off: string }>;
  /** The clear part of the packet the string shows through; absent = the coil sits on the card. */
  window?: { x: number; y: number; w: number; h: number; tint?: string };
  /** The coiled string: centre, radius (of the card's width) and its colour. */
  coil?: { cx: number; cy: number; r: number; colour: string };
  /** The hang slot in the header: its centre height (default 0.035) and the header's colour behind it. */
  hanger?: { y?: number };
  finish?: 'gloss' | 'matte' | 'foil';
}

const HEX = /^#[0-9a-f]{6}$/i;
const inUnit = (v: number, slack = 0) => v >= -slack && v <= 1 + slack;

/** Problems with a packet spec, or an empty list. */
export function packProblems(p: StringPack): string[] {
  const out: string[] = [];
  const colours: string[] = [];
  const stops = (s: Stops) => (typeof s === 'string' ? [s] : s.map(([, c]) => c));
  colours.push(...stops(p.base));
  for (const s of p.shapes ?? []) {
    colours.push(...stops(s.colour));
    if (s.points.length < 3) out.push('shape with fewer than 3 points');
    for (const [x, y] of s.points) if (!inUnit(x, 0.05) || !inUnit(y, 0.05)) out.push(`point ${x},${y} off the card`);
  }
  for (const l of p.lines ?? []) { colours.push(l.colour); if (!inUnit(l.y)) out.push(`line at ${l.y}`); }
  for (const e of p.ellipses ?? []) { colours.push(e.colour); if (!inUnit(e.cx, 0.2) || !inUnit(e.cy, 0.2)) out.push(`ellipse at ${e.cx},${e.cy}`); }
  for (const t of p.texts ?? []) {
    colours.push(t.colour);
    if (!t.text.trim()) out.push('empty text');
    if (t.size <= 0 || t.size > 0.4) out.push(`text size ${t.size}`);
    if (t.scaleX !== undefined && (t.scaleX < 0.5 || t.scaleX > 2)) out.push(`text stretch ${t.scaleX}`);
  }
  for (const m of p.meters ?? []) {
    colours.push(m.on, m.off);
    if (m.filled > m.of || m.of < 1 || m.of > 12) out.push('meter cells');
  }
  if (p.window?.tint) colours.push(p.window.tint);
  if (p.coil) {
    colours.push(p.coil.colour);
    if (p.coil.r <= 0 || p.coil.r > 0.5) out.push(`coil radius ${p.coil.r}`);
  }
  for (const c of colours) if (!HEX.test(c)) out.push(`colour ${c}`);
  if (p.aspect < 1 || p.aspect > 2.2) out.push(`aspect ${p.aspect}`);
  if (!p.source) out.push('no source');
  return out;
}

/* ── Drawing ──────────────────────────────────────────────────────────────── */

/* eslint-disable no-restricted-syntax -- render pixels for a pre-rendered image (shadow, sheen, the
   coil's shading), never UI colour: no theme applies inside a packet picture. */

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const hex = (h: string) => sampleStops(h, 0);
const lighten = (c: RGB, t: number): RGB => [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t];
const darken = (c: RGB, t: number): RGB => [c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t)];
/** The type the packet's words are set in: plain, wide and heavy, never the maker's logo face. */
export const PACK_FONT = '"Liberation Sans", "Helvetica Neue", Arial, sans-serif';

/** A fill for stops running down the card. */
function cardFill(ctx: CanvasRenderingContext2D, s: Stops, y0: number, h: number): string | CanvasGradient {
  if (typeof s === 'string') return s;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  for (const [at, c] of s) g.addColorStop(Math.min(1, Math.max(0, at)), c);
  return g;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A coil of string seen through plastic: loops a little off true, each with a highlight. */
function drawCoil(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, colour: string) {
  const c = hex(colour);
  const width = Math.max(1, r * 0.055);
  const loops = 9;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < loops; i++) {
    // Deterministic wobble so every render of a pack is the same picture.
    const k = i / (loops - 1);
    const rr = r * (0.72 + 0.26 * k);
    const ox = Math.sin(i * 2.1) * r * 0.05;
    const oy = Math.cos(i * 1.7) * r * 0.05;
    const tilt = Math.sin(i * 0.9) * 0.12;
    ctx.beginPath();
    ctx.ellipse(cx + ox, cy + oy, rr, rr * 0.96, tilt, 0, Math.PI * 2);
    ctx.lineWidth = width * 1.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = css(c);
    ctx.stroke();
    // A sheen along the upper-left of each loop.
    ctx.beginPath();
    ctx.ellipse(cx + ox - width * 0.25, cy + oy - width * 0.25, rr, rr * 0.96, tilt, Math.PI * 0.9, Math.PI * 1.7);
    ctx.lineWidth = width * 0.4;
    ctx.strokeStyle = css(lighten(c, 0.6), 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Draw a packet centred in a `w` × `h` canvas region, on a transparent ground,
 * with a soft shadow under it.
 */
export function drawStringPack(ctx: CanvasRenderingContext2D, p: StringPack, w: number, h: number): void {
  const cw = Math.min(w * 0.88, (h * 0.92) / p.aspect);
  const ch = cw * p.aspect;
  const x0 = (w - cw) / 2;
  const y0 = (h - ch) / 2;
  const X = (fx: number) => x0 + fx * cw;
  const Y = (fy: number) => y0 + fy * ch;
  const radius = cw * 0.025;

  // Shadow, then the card.
  ctx.save();
  roundRect(ctx, x0, y0, cw, ch, radius);
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = cw * 0.06;
  ctx.shadowOffsetY = cw * 0.02;
  ctx.fillStyle = cardFill(ctx, p.base, y0, ch);
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x0, y0, cw, ch, radius);
  ctx.clip();

  for (const s of p.shapes ?? []) {
    ctx.beginPath();
    s.points.forEach(([fx, fy], i) => (i === 0 ? ctx.moveTo(X(fx), Y(fy)) : ctx.lineTo(X(fx), Y(fy))));
    ctx.closePath();
    ctx.fillStyle = cardFill(ctx, s.colour, y0, ch);
    ctx.fill();
  }

  for (const e of p.ellipses ?? []) {
    ctx.beginPath();
    ctx.ellipse(X(e.cx), Y(e.cy), e.rx * cw, (e.ry ?? e.rx) * cw, 0, 0, Math.PI * 2);
    ctx.fillStyle = e.colour;
    ctx.fill();
  }

  if (p.window) {
    const { x, y, w: ww, h: wh, tint } = p.window;
    ctx.save();
    roundRect(ctx, X(x), Y(y), ww * cw, wh * ch, cw * 0.02);
    ctx.fillStyle = tint ?? '#e9eef2';
    ctx.globalAlpha = tint ? 1 : 0.9;
    ctx.fill();
    ctx.restore();
  }

  if (p.coil) {
    ctx.save();
    if (p.window) {
      roundRect(ctx, X(p.window.x), Y(p.window.y), p.window.w * cw, p.window.h * ch, cw * 0.02);
      ctx.clip();
    }
    drawCoil(ctx, X(p.coil.cx), Y(p.coil.cy), p.coil.r * cw, p.coil.colour);
    ctx.restore();
  }

  for (const l of p.lines ?? []) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(X(l.x0 ?? 0), Y(l.y));
    ctx.lineTo(X(l.x1 ?? 1), Y(l.y));
    ctx.lineWidth = Math.max(1, (l.width ?? 0.006) * cw);
    ctx.strokeStyle = l.colour;
    if (l.dashed) ctx.setLineDash([cw * 0.008, cw * 0.008]);
    ctx.stroke();
    ctx.restore();
  }

  for (const m of p.meters ?? []) {
    const gap = (m.w * cw) * 0.12 / m.of;
    const cell = (m.w * cw - gap * (m.of - 1)) / m.of;
    for (let i = 0; i < m.of; i++) {
      ctx.fillStyle = i < m.filled ? m.on : m.off;
      ctx.fillRect(X(m.x) + i * (cell + gap), Y(m.y) - cw * 0.006, cell, cw * 0.012);
    }
  }

  for (const t of p.texts ?? []) {
    ctx.save();
    ctx.translate(X(t.x), Y(t.y));
    if (t.rotate) ctx.rotate((t.rotate * Math.PI) / 180);
    if (t.scaleX) ctx.scale(t.scaleX, 1);
    // `size` is the cap height; a cap is about 0.72 of the font size in this face.
    ctx.font = `${t.italic ? 'italic ' : ''}${t.weight ?? 700} ${(t.size * cw) / 0.72}px ${PACK_FONT}`;
    ctx.textAlign = t.align ?? 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.colour;
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }

  // The finish: a broad sheen across the card, stronger for gloss and foil.
  const sheen = p.finish === 'matte' ? 0.06 : p.finish === 'foil' ? 0.3 : 0.16;
  const g = ctx.createLinearGradient(x0, y0, x0 + cw, y0 + ch);
  g.addColorStop(0, `rgba(255,255,255,${sheen})`);
  g.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, `rgba(255,255,255,${sheen * 0.6})`);
  g.addColorStop(0.8, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, cw, ch);
  ctx.restore();

  // The edge: a fine dark line and a lit top edge, so a white card reads on white.
  ctx.save();
  roundRect(ctx, x0 + 0.5, y0 + 0.5, cw - 1, ch - 1, radius);
  ctx.lineWidth = Math.max(1, cw * 0.004);
  ctx.strokeStyle = css(darken(sampleStops(p.base, 0.5), 0.35), 0.5);
  ctx.stroke();
  ctx.restore();

  // The hang slot is a hole: cut it out so the ground shows through.
  if (p.hanger) {
    const hy = Y(p.hanger.y ?? 0.035);
    const sw = cw * 0.16;
    const sh = cw * 0.045;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    roundRect(ctx, x0 + cw / 2 - sw / 2, hy - sh / 2, sw, sh, sh / 2);
    ctx.fill();
    ctx.restore();
  }
}
/* eslint-enable no-restricted-syntax */
