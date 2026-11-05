/**
 * Draws the share card — "Answer 'what are you playing?'" — onto a canvas, for
 * "Save image". Since 2026-11-05 it mirrors the Equipment card (design A,
 * Grant: "This shared card should mirror what the card in app looks like and
 * not truncate"): the eyebrow, the name and the club line; the main racket's
 * head close up across the right; the racket's full name with its role and
 * spec under it; a row per string with its packet, name and tension pill.
 * Every name WRAPS onto a second line rather than being cut short.
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
  /** "At BPM Core since 2026", or null to drop the line. */
  since: string | null;
  /** The main racket's full name and its line under it ("Main racket · 4U · even"). */
  racket: { name: string; sub: string } | null;
  /** Personal stats, number first: `{ num: '4', text: 'restrings since March 2025' }`. */
  stats: Array<{ num: string; text: string }>;
  strings: ShareCanvasString[];
  /** "Grip G5 · 1 of 4 · At BPM Core", or null. */
  footer: string | null;
  lbUnit: string;
}

// eslint-disable-next-line no-restricted-syntax -- canvas pixels: var() does not resolve in a 2D context, and the PNG leaves the app. One line, so the exemption covers exactly this palette.
const INK = { night: '#100F0F', panel: 'rgba(255,255,255,0.035)', accent: '#4ade80', wash: 'rgba(74,222,128,0.12)', clear: 'rgba(74,222,128,0)', text: '#ffffff', hair: 'rgba(255,255,255,0.10)', pill: 'rgba(30,30,34,0.72)', pillLight: 'rgba(255,255,255,0.45)', pillShade: 'rgba(255,255,255,0.10)', opaque: 'rgba(0,0,0,1)', none: 'rgba(0,0,0,0)' } as const;

export const SHARE_W = 360;
const SCALE = 3;
const PAD = 22;
/** The packet at a string row's start, as the card draws it. */
const PACK_W = 26;
const PACK_H = 36;
/** The head close-up: its width on the card, its tilt, and where it sits. */
const HEAD_W = 236;
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

interface Layout { ops: Op[]; height: number }

/** The racket's lines stop short of the head, about two thirds across. */
const RACKET_TEXT_W = SHARE_W - PAD * 2 - 108;

function layout(m: Measurer, c: ShareCanvasContent): Layout {
  const F = readFaces();
  const ops: Op[] = [];
  const text = (s: string, x: number, y: number, font: string, fill: string, alpha = 1, align: CanvasTextAlign = 'left') => {
    ops.push((ctx) => {
      ctx.font = font; ctx.fillStyle = fill; ctx.globalAlpha = alpha; ctx.textAlign = align;
      ctx.fillText(s, x, y);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    });
  };

  let y = PAD + 10;
  text(c.eyebrow.toUpperCase(), PAD, y, `700 10px ${F.sans}`, INK.text, 0.55);
  y += 28;
  text(c.name, PAD, y, `700 24px ${F.display}`, INK.text);
  if (c.since) {
    y += 19;
    text(c.since, PAD, y, `400 12px ${F.sans}`, INK.text, 0.6);
  }

  if (c.racket) {
    y += 30;
    m.font = `600 18px ${F.sans}`;
    const nameLines = wrapText(m, c.racket.name, RACKET_TEXT_W);
    nameLines.forEach((l, i) => text(l, PAD, y + i * 22, `600 18px ${F.sans}`, INK.text));
    y += (nameLines.length - 1) * 22 + 19;
    m.font = `400 12px ${F.sans}`;
    const subLines = wrapText(m, c.racket.sub, RACKET_TEXT_W);
    subLines.forEach((l, i) => text(l, PAD, y + i * 16, `400 12px ${F.sans}`, INK.text, 0.62));
    y += (subLines.length - 1) * 16;
  }
  for (const s of c.stats) {
    y += 18;
    const yy = y;
    m.font = `700 12px ${F.mono}`;
    const numW = m.measureText(s.num).width;
    text(s.num, PAD, yy, `700 12px ${F.mono}`, INK.accent);
    text(s.text, PAD + numW + 5, yy, `400 12px ${F.sans}`, INK.text, 0.78);
  }

  if (c.strings.length) y += 14;
  for (const s of c.strings) {
    // Pill first: its width sets how much line the name may take.
    const lbs = s.lbs !== null ? String(s.lbs) : null;
    m.font = `700 17px ${F.mono}`;
    const numW = lbs ? m.measureText(lbs).width : 0;
    m.font = `400 11px ${F.sans}`;
    const unitW = lbs ? m.measureText(c.lbUnit).width : 0;
    const pillW = lbs ? numW + unitW + 4 + 24 : 0;
    const textX = PAD + (s.packet ? PACK_W + 12 : 0);
    const textW = SHARE_W - PAD - textX - (pillW ? pillW + 10 : 0);
    m.font = `600 15px ${F.sans}`;
    const nameLines = wrapText(m, s.name, textW);
    m.font = `400 12px ${F.sans}`;
    const subLines = wrapText(m, s.sub, textW);
    const textH = nameLines.length * 19 + subLines.length * 16;
    const rowH = Math.max(PACK_H, textH);
    const top = y + 8;
    const midY = top + rowH / 2;
    const textTop = midY - textH / 2;
    if (s.packet) {
      const packet = s.packet;
      const py = midY - PACK_H / 2;
      ops.push((ctx) => { ctx.drawImage(packet, PAD, py, PACK_W, PACK_H); });
    }
    nameLines.forEach((l, i) => text(l, textX, textTop + 14 + i * 19, `600 15px ${F.sans}`, INK.text));
    subLines.forEach((l, i) => text(l, textX, textTop + nameLines.length * 19 + 12 + i * 16, `400 12px ${F.sans}`, INK.text, 0.6));
    if (lbs) {
      const px = SHARE_W - PAD - pillW;
      const ph = 30;
      const py = midY - ph / 2;
      ops.push((ctx) => {
        // The card's glass pill, as paint: a dark frost so the strings behind
        // it never cross the figure, lit along its top-left edge.
        roundRect(ctx, px, py, pillW, ph, ph / 2);
        ctx.fillStyle = INK.pill;
        ctx.fill();
        ctx.save();
        roundRect(ctx, px + 0.5, py + 0.5, pillW - 1, ph - 1, ph / 2 - 0.5);
        const edge = ctx.createLinearGradient(px, py, px + pillW, py + ph);
        edge.addColorStop(0, INK.pillLight);
        edge.addColorStop(0.5, INK.pillShade);
        edge.addColorStop(1, INK.pillShade);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        ctx.font = `700 17px ${F.mono}`;
        ctx.fillStyle = INK.text;
        ctx.fillText(lbs, px + 12, py + 21);
        ctx.font = `400 11px ${F.sans}`;
        ctx.globalAlpha = 0.7;
        ctx.fillText(c.lbUnit, px + 12 + numW + 4, py + 21);
        ctx.globalAlpha = 1;
      });
    }
    y = top + rowH;
  }

  y += 22;
  if (c.footer) {
    m.font = `400 11px ${F.sans}`;
    const lines = wrapText(m, c.footer, SHARE_W - PAD * 2 - 50);
    lines.forEach((l, i) => text(l, PAD, y + i * 15, `400 11px ${F.sans}`, INK.text, 0.6));
    text('b p m', SHARE_W - PAD, y, `600 10px ${F.mono}`, INK.text, 0.45, 'right');
    y += (lines.length - 1) * 15;
  } else {
    text('b p m', SHARE_W - PAD, y, `600 10px ${F.mono}`, INK.text, 0.45, 'right');
  }
  return { ops, height: Math.ceil(y + PAD - 4) };
}

/** The card's height for this content: rows that are dropped take no room. */
export function shareCardHeight(m: Measurer, c: ShareCanvasContent): number {
  return layout(m, c).height;
}

/** The racket head, tilted in from the right, faded into the card on its left
 *  and toward its bottom so the rows over it stay readable. */
function drawHead(ctx: CanvasRenderingContext2D, head: CanvasImageSource & { width: number; height: number }, W: number, H: number) {
  const off = document.createElement('canvas');
  off.width = W * SCALE;
  off.height = H * SCALE;
  const o = off.getContext('2d');
  if (!o) return;
  o.scale(SCALE, SCALE);
  const w = HEAD_W;
  const h = (head.height / head.width) * w;
  o.save();
  o.translate(W - w / 2 + 80, h / 2 - 34);
  o.rotate(HEAD_TILT);
  o.drawImage(head, -w / 2, -h / 2, w, h);
  o.restore();
  o.globalCompositeOperation = 'destination-in';
  const left = o.createLinearGradient(W - 210, 0, W - 80, 0);
  left.addColorStop(0, INK.none);
  left.addColorStop(1, INK.opaque);
  o.fillStyle = left;
  o.fillRect(0, 0, W, H);
  const down = o.createLinearGradient(0, h * 0.55, 0, h * 0.98);
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
  const { ops, height } = layout(probe, c);
  const W = SHARE_W;
  const H = height;
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = 'alphabetic';

  // Ground, the card's soft panel, one accent wash from the top right, and the
  // inset hairline.
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.fillStyle = INK.night;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 18);
  ctx.clip();
  ctx.fillStyle = INK.panel;
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W * 0.9, 0, 0, W * 0.9, 0, W * 0.75);
  wash.addColorStop(0, INK.wash);
  wash.addColorStop(1, INK.clear);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  if (head && head.width > 0) drawHead(ctx, head, W, H);
  ctx.restore();
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 17.5);
  ctx.strokeStyle = INK.hair;
  ctx.lineWidth = 1;
  ctx.stroke();

  for (const op of ops) op(ctx);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
