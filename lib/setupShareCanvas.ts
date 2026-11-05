/**
 * Draws the share image — "Answer 'what are you playing?'" — onto a canvas,
 * for "Save image". It is a STORY: 9:16, 1080 × 1920 (Grant, 2026-11-05: "Omg
 * it's so busy. We can break out of the current size. Can be vertical ig
 * story size"). It carries the Equipment card's own things (design A) and
 * little else: the name at the top, the main racket's head large across the
 * middle, then the racket's full name with its role and spec, a row per string
 * with its packet and tension pill, and one quiet line at the foot. Every name
 * WRAPS onto a second line rather than being cut short ("not truncate").
 *
 * Story apps lay their own controls over the top and bottom of the frame, so
 * the words sit inside `SAFE_TOP`..`SAFE_BOTTOM`; only the ground and the
 * racket run to the edges.
 *
 * Canvas, not a DOM screenshot: the PNG must look the same on every device,
 * and `lib/shareImage.ts` already knows how to hand a canvas to the share
 * sheet, a download, or iOS's press-and-hold. Colours are literal on purpose —
 * the image leaves the app, so it cannot follow the viewer's theme, and a CSS
 * custom property does not resolve inside a canvas anyway. It is the design
 * system's DARK pairing: `--bpm-night` ground, `#4ade80` accent.
 *
 * Draws only what it is handed, already in words: the facts are decided (and
 * dropped when unknown) by `lib/shareCard.ts`, the language by the sheet.
 */

export interface ShareCanvasString {
  /** The packet drawn at the row's start, or null for a string with none. */
  packet: CanvasImageSource | null;
  /** The full name, as the card shows it ("Victor VBS-66 Nano"). */
  name: string;
  /** "Strings · 0.68mm · repulsion", "Mains · …", "Crosses · …". */
  sub: string;
  lbs: number | null;
}

export interface ShareCanvasContent {
  eyebrow: string;
  name: string;
  /** The main racket's full name and its line under it ("Main racket · 4U · even"). */
  racket: { name: string; sub: string } | null;
  strings: ShareCanvasString[];
  /** One quiet line at the foot ("Grip G5 · At BPM Core since 2024"), or null. */
  footer: string | null;
  lbUnit: string;
}

// eslint-disable-next-line no-restricted-syntax -- canvas pixels: var() does not resolve in a 2D context, and the PNG leaves the app. One line, so the exemption covers exactly this palette.
const INK = { night: '#100F0F', accent: '#4ade80', wash: 'rgba(74,222,128,0.16)', clear: 'rgba(74,222,128,0)', text: '#ffffff', pill: 'rgba(30,30,34,0.72)', pillLight: 'rgba(255,255,255,0.45)', pillShade: 'rgba(255,255,255,0.10)', opaque: 'rgba(0,0,0,1)', none: 'rgba(0,0,0,0)' } as const;

/** The story frame in layout units; exported at `SCALE` (1080 × 1920). */
export const SHARE_W = 360;
export const SHARE_H = 640;
const SCALE = 3;
const PAD = 28;
/** Where story apps' own controls end at the top and begin at the bottom. */
const SAFE_TOP = 84;
const SAFE_BOTTOM = 548;
/** The packet at a string row's start, as the card draws it. */
const PACK_W = 30;
const PACK_H = 42;
/** The head close-up's tilt, as on the card. */
const HEAD_TILT = (-14 * Math.PI) / 180;

/** The app's own faces. next/font serves them under generated family names,
 *  so a literal 'IBM Plex Sans' would fall through to the system face; the
 *  type tokens on <html> carry the real names. */
interface Faces { display: string; sans: string; mono: string }
const FALLBACK: Faces = {
  display: "'Space Grotesk', 'IBM Plex Sans', -apple-system, sans-serif",
  sans: "'IBM Plex Sans', -apple-system, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
};
function readFaces(): Faces {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).replace(/\s+/g, ' ').trim() || fallback;
  return { display: read('--font-display', FALLBACK.display), sans: read('--font-sans', FALLBACK.sans), mono: read('--font-mono', FALLBACK.mono) };
}

type Measurer = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

/**
 * Words onto lines no wider than `max`, at most `lines` of them. A single word
 * wider than the line is kept whole; only past the last allowed line is the
 * tail shortened, which no real racket or string name reaches at two lines.
 */
export function wrapText(ctx: Measurer, text: string, max: number, lines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= max) { line = next; continue; }
    out.push(line);
    line = word;
  }
  if (line) out.push(line);
  if (out.length <= lines) return out;
  const kept = out.slice(0, lines);
  let last = `${kept[lines - 1]} ${out.slice(lines).join(' ')}`;
  while (last.length > 1 && ctx.measureText(`${last}…`).width > max) last = last.slice(0, -1);
  kept[lines - 1] = `${last.trimEnd()}…`;
  return kept;
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

/** One drawing step, laid out once (measured) and then painted. */
type Op = (ctx: CanvasRenderingContext2D) => void;

export interface StoryLayout {
  ops: Op[];
  /** Where the words under the racket begin; the racket fills the space above. */
  blockTop: number;
}

/**
 * Lays the words out: the name at the top, everything else stacked UP from
 * `SAFE_BOTTOM`, so a long name pushes the racket up rather than the words off
 * the frame.
 */
export function storyLayout(m: Measurer, c: ShareCanvasContent): StoryLayout {
  const F = readFaces();
  const top: Op[] = [];
  const block: Array<(dy: number) => Op> = [];
  const text = (to: Op[] | null, s: string, x: number, y: number, font: string, alpha = 1, align: CanvasTextAlign = 'left', fill: string = INK.text) => {
    const paint = (dy: number): Op => (ctx) => {
      ctx.font = font; ctx.fillStyle = fill; ctx.globalAlpha = alpha; ctx.textAlign = align;
      ctx.fillText(s, x, y + dy);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    };
    if (to) to.push(paint(0)); else block.push(paint);
  };
  const W = SHARE_W - PAD * 2;

  // The top: the eyebrow, the name under it.
  text(top, c.eyebrow.toUpperCase(), PAD, SAFE_TOP + 10, `700 11px ${F.sans}`, 0.55);
  m.font = `700 36px ${F.display}`;
  wrapText(m, c.name, W).forEach((l, i) => text(top, l, PAD, SAFE_TOP + 52 + i * 40, `700 36px ${F.display}`));

  // The block, measured from 0 and moved into place once its height is known.
  let y = 0;
  if (c.racket) {
    m.font = `600 24px ${F.sans}`;
    const nameLines = wrapText(m, c.racket.name, W, 3);
    nameLines.forEach((l, i) => text(null, l, PAD, y + 24 + i * 29, `600 24px ${F.sans}`));
    y += 24 + (nameLines.length - 1) * 29;
    m.font = `400 14px ${F.sans}`;
    const subLines = wrapText(m, c.racket.sub, W);
    subLines.forEach((l, i) => text(null, l, PAD, y + 24 + i * 19, `400 14px ${F.sans}`, 0.62));
    y += 24 + (subLines.length - 1) * 19 + 8;
  }

  if (c.strings.length) y += 18;
  c.strings.forEach((s, idx) => {
    if (idx > 0) y += 16;
    // Pill first: its width sets how much line the name may take.
    const lbs = s.lbs !== null ? String(s.lbs) : null;
    m.font = `700 20px ${F.mono}`;
    const numW = lbs ? m.measureText(lbs).width : 0;
    m.font = `400 12px ${F.sans}`;
    const unitW = lbs ? m.measureText(c.lbUnit).width : 0;
    const pillW = lbs ? numW + unitW + 5 + 28 : 0;
    const textX = PAD + (s.packet ? PACK_W + 14 : 0);
    const textW = SHARE_W - PAD - textX - (pillW ? pillW + 12 : 0);
    m.font = `600 17px ${F.sans}`;
    const nameLines = wrapText(m, s.name, textW, 3);
    m.font = `400 13px ${F.sans}`;
    const subLines = wrapText(m, s.sub, textW);
    const textH = nameLines.length * 21 + subLines.length * 17;
    const rowH = Math.max(PACK_H, textH);
    const rowTop = y;
    const midY = rowTop + rowH / 2;
    const textTop = midY - textH / 2;
    if (s.packet) {
      const packet = s.packet;
      block.push((dy) => (ctx) => { ctx.drawImage(packet, PAD, midY - PACK_H / 2 + dy, PACK_W, PACK_H); });
    }
    nameLines.forEach((l, i) => text(null, l, textX, textTop + 16 + i * 21, `600 17px ${F.sans}`));
    subLines.forEach((l, i) => text(null, l, textX, textTop + nameLines.length * 21 + 14 + i * 17, `400 13px ${F.sans}`, 0.6));
    if (lbs) {
      const px = SHARE_W - PAD - pillW;
      const ph = 36;
      block.push((dy) => (ctx) => {
        const py = midY - ph / 2 + dy;
        // The card's glass pill, as paint: a dark frost lit along its top-left edge.
        roundRect(ctx, px, py, pillW, ph, ph / 2);
        ctx.fillStyle = INK.pill;
        ctx.fill();
        roundRect(ctx, px + 0.5, py + 0.5, pillW - 1, ph - 1, ph / 2 - 0.5);
        const edge = ctx.createLinearGradient(px, py, px + pillW, py + ph);
        edge.addColorStop(0, INK.pillLight);
        edge.addColorStop(0.5, INK.pillShade);
        edge.addColorStop(1, INK.pillShade);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = `700 20px ${F.mono}`;
        ctx.fillStyle = INK.text;
        ctx.fillText(lbs, px + 14, py + 25);
        ctx.font = `400 12px ${F.sans}`;
        ctx.globalAlpha = 0.7;
        ctx.fillText(c.lbUnit, px + 14 + numW + 5, py + 25);
        ctx.globalAlpha = 1;
      });
    }
    y = rowTop + rowH;
  });

  // The foot: the quiet line, and the wordmark at its end (clear of the racket).
  y += 26;
  if (c.footer) {
    m.font = `400 13px ${F.sans}`;
    const lines = wrapText(m, c.footer, W - 56);
    lines.forEach((l, i) => text(null, l, PAD, y + 13 + i * 17, `400 13px ${F.sans}`, 0.55));
    text(null, 'b p m', SHARE_W - PAD, y + 13, `600 11px ${F.mono}`, 0.45, 'right');
    y += 13 + (lines.length - 1) * 17;
  } else {
    text(null, 'b p m', SHARE_W - PAD, y + 13, `600 11px ${F.mono}`, 0.45, 'right');
    y += 13;
  }

  const blockTop = SAFE_BOTTOM - y;
  return { ops: [...top, ...block.map((b) => b(blockTop))], blockTop };
}

/** The racket head, tilted in from the right across the middle of the story,
 *  faded on its left and into the words below it. */
function drawHead(ctx: CanvasRenderingContext2D, head: CanvasImageSource & { width: number; height: number }, blockTop: number) {
  const W = SHARE_W;
  const H = SHARE_H;
  const off = document.createElement('canvas');
  off.width = W * SCALE;
  off.height = H * SCALE;
  const o = off.getContext('2d');
  if (!o) return;
  o.scale(SCALE, SCALE);
  // From just under the eyebrow to a little into the words, which it fades under.
  // The picture is the head with room around it, so it is drawn larger than
  // the space and runs off the right edge, as on the card.
  const areaTop = SAFE_TOP + 20;
  const h = Math.max(320, Math.min(620, (blockTop + 30 - areaTop) * 1.5));
  const w = (head.width / head.height) * h;
  o.save();
  o.translate(W - w * 0.36, areaTop + h * 0.4);
  o.rotate(HEAD_TILT);
  o.drawImage(head, -w / 2, -h / 2, w, h);
  o.restore();
  o.globalCompositeOperation = 'destination-in';
  const left = o.createLinearGradient(W - w * 0.86, 0, W - w * 0.5, 0);
  left.addColorStop(0, INK.none);
  left.addColorStop(1, INK.opaque);
  o.fillStyle = left;
  o.fillRect(0, 0, W, H);
  const down = o.createLinearGradient(0, blockTop - 70, 0, blockTop + 10);
  down.addColorStop(0, INK.opaque);
  down.addColorStop(1, INK.none);
  o.fillStyle = down;
  o.fillRect(0, 0, W, H);
  ctx.drawImage(off, 0, 0, W, H);
}

export function drawSetupShareCanvas(
  canvas: HTMLCanvasElement,
  c: ShareCanvasContent,
  head: (CanvasImageSource & { width: number; height: number }) | null,
): string {
  const probe = canvas.getContext('2d');
  if (!probe) return '';
  const { ops, blockTop } = storyLayout(probe, c);
  const W = SHARE_W;
  const H = SHARE_H;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  // Full bleed: the night ground and one accent wash from the top right.
  ctx.fillStyle = INK.night;
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W * 0.85, H * 0.18, 0, W * 0.85, H * 0.18, W * 0.95);
  wash.addColorStop(0, INK.wash);
  wash.addColorStop(1, INK.clear);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  if (head && head.width > 0) drawHead(ctx, head, blockTop);

  for (const op of ops) op(ctx);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
