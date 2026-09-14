/**
 * Draws the share card — "Answer 'what are you playing?'" (design "Equipment
 * redesign" 2a screen 07, reworked) — onto a canvas, for "Save image".
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

export interface ShareCanvasContent {
  initial: string;
  name: string;
  /** "Thursdays at BPM since 2024", or null to drop the line. */
  since: string | null;
  racketName: string | null;
  /** "Li-Ning · 4U · even balance". */
  specs: string | null;
  /** Personal stats, number first: `{ num: '4', text: 'restrings since March 2025' }`. */
  stats: Array<{ num: string; text: string }>;
  /** Up to four facts across the bottom. */
  facts: Array<{ label: string; value: string; unit?: string }>;
}

// eslint-disable-next-line no-restricted-syntax -- canvas pixels: var() does not resolve in a 2D context, and the PNG leaves the app. One line, so the exemption covers exactly this palette.
const INK = { night: '#100F0F', accent: '#4ade80', wash: 'rgba(74,222,128,0.16)', washMid: 'rgba(74,222,128,0.04)', clear: 'rgba(74,222,128,0)', text: '#ffffff', hair: 'rgba(255,255,255,0.10)', rule: 'rgba(255,255,255,0.14)', avatarRing: 'rgba(74,222,128,0.35)', shadow: 'rgba(0,0,0,0.5)' } as const;

export const SHARE_W = 360;
const SCALE = 3;
const PAD = 20;
const IMG_W = 42;
const IMG_H = 112;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out}…`;
}

/** The card's height for this content: rows that are dropped take no room. */
export function shareCardHeight(c: ShareCanvasContent): number {
  const frameTop = PAD + 32 + 18;
  const textBottom = frameTop + 22 + (c.specs ? 18 : 0) + c.stats.length * 18;
  const frameBottom = Math.max(textBottom, frameTop + IMG_H - 8);
  return frameBottom + (c.facts.length ? 18 + 14 + 44 : 0) + PAD;
}

export function drawSetupShareCanvas(
  canvas: HTMLCanvasElement,
  c: ShareCanvasContent,
  racketImage: HTMLImageElement | null,
): string {
  const W = SHARE_W;
  const H = shareCardHeight(c);
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(SCALE, SCALE);

  const display = "'Space Grotesk', 'IBM Plex Sans', -apple-system, sans-serif";
  const sans = "'IBM Plex Sans', -apple-system, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

  // Ground, the one accent wash from the top right, and the inset hairline.
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = INK.night;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.clip();
  const wash = ctx.createRadialGradient(W * 0.88, 0, 0, W * 0.88, 0, W * 0.8);
  wash.addColorStop(0, INK.wash);
  wash.addColorStop(0.48, INK.washMid);
  wash.addColorStop(0.74, INK.clear);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  roundRect(ctx, 0.5, 0.5, W - 1, H - 1, 15.5);
  ctx.strokeStyle = INK.hair;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = 'alphabetic';

  // Identity: avatar, name over tenure, wordmark.
  const AV = 16;
  ctx.beginPath();
  ctx.arc(PAD + AV, PAD + AV, AV, 0, Math.PI * 2);
  ctx.fillStyle = INK.wash;
  ctx.fill();
  ctx.strokeStyle = INK.avatarRing;
  ctx.stroke();
  ctx.fillStyle = INK.accent;
  ctx.font = `700 14px ${display}`;
  ctx.textAlign = 'center';
  ctx.fillText(c.initial, PAD + AV, PAD + AV + 5);
  ctx.textAlign = 'left';
  const idX = PAD + AV * 2 + 10;
  ctx.fillStyle = INK.text;
  ctx.font = `600 14px ${sans}`;
  ctx.fillText(fit(ctx, c.name, W - idX - PAD - 40), idX, c.since ? PAD + 14 : PAD + 21);
  if (c.since) {
    ctx.globalAlpha = 0.6;
    ctx.font = `400 11px ${sans}`;
    ctx.fillText(fit(ctx, c.since, W - idX - PAD - 40), idX, PAD + 30);
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = 0.45;
  ctx.font = `600 10px ${mono}`;
  ctx.textAlign = 'right';
  ctx.fillText('b p m', W - PAD, PAD + 14);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;

  // Frame: name, specs, the personal stats; the racket upright on the right.
  const frameTop = PAD + 32 + 18;
  const textW = W - PAD * 2 - IMG_W - 12;
  let y = frameTop + 20;
  if (c.racketName) {
    ctx.fillStyle = INK.text;
    ctx.font = `700 22px ${display}`;
    ctx.fillText(fit(ctx, c.racketName, textW), PAD, y);
  }
  if (c.specs) {
    y += 18;
    ctx.globalAlpha = 0.62;
    ctx.font = `400 12px ${sans}`;
    ctx.fillText(fit(ctx, c.specs, textW), PAD, y);
    ctx.globalAlpha = 1;
  }
  for (const s of c.stats) {
    y += 18;
    ctx.font = `700 12px ${mono}`;
    ctx.fillStyle = INK.accent;
    ctx.fillText(s.num, PAD, y);
    const numW = ctx.measureText(s.num).width;
    ctx.font = `400 12px ${sans}`;
    ctx.fillStyle = INK.text;
    ctx.globalAlpha = 0.78;
    ctx.fillText(fit(ctx, s.text, textW - numW - 5), PAD + numW + 5, y);
    ctx.globalAlpha = 1;
  }
  if (racketImage && racketImage.complete && racketImage.naturalWidth > 0) {
    const ratio = racketImage.naturalWidth / racketImage.naturalHeight;
    const ih = Math.min(IMG_H, IMG_W / ratio);
    const iw = ih * ratio;
    ctx.save();
    ctx.shadowColor = INK.shadow;
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(racketImage, W - PAD - IMG_W + (IMG_W - iw) / 2, frameTop - 6, iw, ih);
    ctx.restore();
  }

  // Facts: a four-column grid so labels and values line up across columns,
  // every value on one baseline (tension stays at 18px — at 22 it hung low).
  if (c.facts.length) {
    const frameBottom = Math.max(y, frameTop + IMG_H - 8);
    const ruleY = frameBottom + 18;
    ctx.strokeStyle = INK.rule;
    ctx.beginPath();
    ctx.moveTo(PAD, ruleY);
    ctx.lineTo(W - PAD, ruleY);
    ctx.stroke();
    const colW = (W - PAD * 2 - 30) / 4;
    c.facts.slice(0, 4).forEach((f, i) => {
      const x = PAD + i * (colW + 10);
      ctx.fillStyle = INK.text;
      ctx.globalAlpha = 0.6;
      ctx.font = `700 10px ${sans}`;
      ctx.fillText(fit(ctx, f.label.toUpperCase(), colW), x, ruleY + 14 + 10);
      ctx.globalAlpha = 1;
      const base = ruleY + 14 + 10 + 26;
      if (f.unit) {
        ctx.font = `700 18px ${mono}`;
        ctx.fillStyle = INK.accent;
        ctx.fillText(f.value, x, base);
        const vw = ctx.measureText(f.value).width;
        ctx.font = `400 11px ${sans}`;
        ctx.globalAlpha = 0.7;
        ctx.fillText(f.unit, x + vw + 3, base);
        ctx.globalAlpha = 1;
      } else {
        ctx.font = `600 14px ${sans}`;
        ctx.fillStyle = INK.text;
        ctx.fillText(fit(ctx, f.value, colW), x, base);
      }
    });
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
