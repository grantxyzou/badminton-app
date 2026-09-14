import type { SetupShare } from './gearSetup';

/**
 * Draws the share card ("Grant's set-up") onto a canvas, for "Save image".
 *
 * Canvas, not a DOM screenshot: the PNG must look the same on every device,
 * and `lib/shareImage.ts` already knows how to hand a canvas to the share
 * sheet, a download, or iOS's press-and-hold. Colours are literal on purpose —
 * the image leaves the app, so it cannot follow the viewer's theme, and a CSS
 * custom property does not resolve inside a canvas anyway.
 *
 * Takes a `SetupShare` and labels, nothing else — the gear-only promise on the
 * sheet is enforced by what this function can be given.
 */

export interface SetupCanvasLabels {
  title: string;
  racket: string;
  string: string;
  lb: string;
}

// eslint-disable-next-line no-restricted-syntax -- canvas pixels: var() does not resolve in a 2D context, and the PNG leaves the app, so it cannot follow a theme. One line, so the exemption covers exactly these five.
const INK = { greenTop: '#16a34a', greenDeep: '#0f7a37', text: '#ffffff', rule: 'rgba(255,255,255,0.22)', shadow: 'rgba(0,0,0,0.25)' } as const;

const W = 360;
const H = 196;
const SCALE = 3;

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

export function drawSetupShareCanvas(
  canvas: HTMLCanvasElement,
  share: SetupShare,
  labels: SetupCanvasLabels,
  racketImage: HTMLImageElement | null,
): string {
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.scale(SCALE, SCALE);

  const display = "'Space Grotesk', 'IBM Plex Sans', -apple-system, sans-serif";
  const sans = "'IBM Plex Sans', -apple-system, sans-serif";
  const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

  // Card: the app's green, top-left light to bottom-right deep.
  const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
  g.addColorStop(0, INK.greenTop);
  g.addColorStop(1, INK.greenDeep);
  roundRect(ctx, 0, 0, W, H, 16);
  ctx.fillStyle = g;
  ctx.fill();

  const PAD = 20;
  const IMG_W = 46;
  const textRight = W - PAD - IMG_W - 14;

  ctx.fillStyle = INK.text;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 18px ${display}`;
  ctx.fillText(fit(ctx, labels.title, W - PAD * 2 - 40), PAD, PAD + 18);
  ctx.globalAlpha = 0.8;
  ctx.font = `400 11px ${mono}`;
  ctx.textAlign = 'right';
  ctx.fillText('bpm', W - PAD, PAD + 16);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;

  const LABEL_X = PAD;
  const VALUE_X = PAD + 74;
  const row = (y: number, label: string, value: string, lb: number | null) => {
    ctx.globalAlpha = 0.75;
    ctx.font = `700 10px ${sans}`;
    ctx.fillText(label.toUpperCase(), LABEL_X, y);
    ctx.globalAlpha = 1;
    let right = textRight;
    if (lb !== null) {
      ctx.font = `400 11px ${sans}`;
      const unitW = ctx.measureText(labels.lb).width;
      ctx.globalAlpha = 0.8;
      ctx.textAlign = 'right';
      ctx.fillText(labels.lb, textRight, y);
      ctx.globalAlpha = 1;
      ctx.font = `700 18px ${mono}`;
      ctx.fillText(String(lb), textRight - unitW - 2, y);
      ctx.textAlign = 'left';
      right = textRight - unitW - 2 - ctx.measureText(String(lb)).width - 8;
    }
    ctx.font = `600 15px ${sans}`;
    ctx.fillText(fit(ctx, value, right - VALUE_X), VALUE_X, y);
  };

  const ROW1 = 104;
  const ROW2 = 150;
  if (share.racket) row(ROW1, labels.racket, share.racket, null);
  ctx.strokeStyle = INK.rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, ROW1 + 16);
  ctx.lineTo(textRight, ROW1 + 16);
  ctx.stroke();
  if (share.string) row(ROW2, labels.string, share.string, share.tensionLbs);

  if (racketImage && racketImage.complete && racketImage.naturalWidth > 0) {
    const ih = 136;
    const iw = ih * (racketImage.naturalWidth / racketImage.naturalHeight);
    ctx.save();
    ctx.shadowColor = INK.shadow;
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    ctx.drawImage(racketImage, W - PAD - IMG_W + (IMG_W - iw) / 2, H - PAD - ih + 4, iw, ih);
    ctx.restore();
  }

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
