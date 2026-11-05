/**
 * The invite as a picture: "Save as image" on the Invite page
 * (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.3).
 *
 * An organiser sends it to one person, or holds it up on a phone: the club's
 * name, who runs it, when it plays and where, and the one-time invite's QR
 * and code. Everything on it comes in already in words; this file only draws.
 *
 * Canvas, not a DOM screenshot, for the same reasons as the share card
 * (`lib/setupShareCanvas.ts`): the PNG must look the same on every phone, and
 * `lib/shareImage.ts` already knows how to hand a canvas to the share sheet,
 * a download, or iOS's press-and-hold. Colours are literal because the image
 * leaves the app and a CSS custom property does not resolve inside a canvas.
 * It is LIGHT whatever the theme, because a camera reads dark-on-light codes
 * best (the on-page code is drawn the same way, `.invite-qr`).
 */

export interface PosterContent {
  /** "You're invited to". */
  eyebrow: string;
  club: string;
  /** "Organised by Grant", or null to drop the line. */
  organisers: string | null;
  /** "When" / "Where" labels, already translated. */
  whenLabel: string;
  whereLabel: string;
  /** "Every Thursday · 8:00 – 10:00 PM", or null. */
  cadence: string | null;
  location: string | null;
  address: string | null;
  /** The QR grid (`qrGrid`), quiet zone included. */
  qr: { size: number; data: boolean[][] };
  scanLine: string;
  codeLine: string;
  /** "ABCD EFGH". */
  code: string;
  /** "Works once, for one person, until Nov 12". */
  onceLine: string;
  appName: string;
}

// eslint-disable-next-line no-restricted-syntax -- canvas pixels: var() does not resolve in a 2D context, and the PNG leaves the app. One line, so the exemption covers exactly this palette.
const INK = { ground: '#ffffff', ink: '#111111', secondary: '#3f3f46', muted: '#71717a', accent: '#16a34a', panel: '#f4f4f5' } as const;

export const POSTER_W = 360;
const SCALE = 3;
const PAD = 28;
const QR_PX = 216;
const LINE = { club: 34, fact: 21, small: 18 };

const DISPLAY = "'Space Grotesk', 'IBM Plex Sans', -apple-system, sans-serif";
const SANS = "'IBM Plex Sans', -apple-system, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, Menlo, monospace";

/**
 * "Every Thursday · 8:00 – 10:00 PM" from the active session, as two parts the
 * caller words. The weekday and times are read in Vancouver time, the zone
 * every other session display is pinned to (CLAUDE.md, "Session times").
 * Null when the session has no readable date.
 */
export function posterWhen(
  datetime: string | null | undefined,
  endDatetime: string | null | undefined,
  locale: string,
): { day: string; time: string } | null {
  if (!datetime) return null;
  const start = new Date(datetime);
  if (Number.isNaN(start.getTime())) return null;
  const tz = 'America/Vancouver';
  const day = start.toLocaleDateString(locale, { weekday: 'long', timeZone: tz });
  const clock = (d: Date) => d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const end = endDatetime ? new Date(endDatetime) : null;
  const time = end && !Number.isNaN(end.getTime()) ? `${clock(start)} – ${clock(end)}` : clock(start);
  return { day, time };
}

/** Breaks `text` into lines no wider than `max`, at spaces where it can. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines.map((l) => fit(ctx, l, max));
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fit(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, max);
  return kept;
}

/** By hand: `ctx.roundRect` is missing from the iOS 15 WebView the app still supports. */
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

/**
 * Draws the poster and returns it as a PNG data URL ('' when the canvas has
 * no 2D context). The height follows the content: a dropped line takes no room.
 */
export function drawInvitePoster(canvas: HTMLCanvasElement, c: PosterContent): string {
  const W = POSTER_W;
  const inner = W - PAD * 2;

  // Measure first, on the canvas's own context, so the height is exact.
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.font = `700 28px ${DISPLAY}`;
  const clubLines = wrap(ctx, c.club, inner, 2);
  ctx.font = `600 15px ${SANS}`;
  const whenLines = c.cadence ? wrap(ctx, c.cadence, inner - 24, 2) : [];
  const whereLines = c.location ? wrap(ctx, c.location, inner - 24, 2) : [];
  ctx.font = `400 13px ${SANS}`;
  const addressLines = c.address ? wrap(ctx, c.address, inner - 24, 2) : [];
  const hasFacts = whenLines.length + whereLines.length > 0;

  let H = 6 + PAD; // accent band, then padding
  H += LINE.small; // eyebrow
  H += clubLines.length * LINE.club;
  if (c.organisers) H += LINE.small + 4;
  if (hasFacts) {
    H += 20 + 16; // gap, panel top padding
    if (whenLines.length) H += LINE.small + whenLines.length * LINE.fact;
    if (whenLines.length && whereLines.length) H += 12;
    if (whereLines.length) H += LINE.small + whereLines.length * LINE.fact + addressLines.length * LINE.small;
    H += 16; // panel bottom padding
  }
  H += 24 + QR_PX + 12 + LINE.small; // QR and its line
  H += 16 + LINE.small + 30; // code
  H += 20 + LINE.small; // once line
  H += 20 + LINE.small + PAD; // app name

  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  // Resizing a canvas resets its context, so scale after.
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = INK.ground;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK.accent;
  ctx.fillRect(0, 0, W, 6);

  let y = 6 + PAD;
  ctx.fillStyle = INK.muted;
  ctx.font = `500 13px ${SANS}`;
  y += 13;
  ctx.fillText(c.eyebrow, PAD, y);
  y += LINE.small - 13;

  ctx.fillStyle = INK.ink;
  ctx.font = `700 28px ${DISPLAY}`;
  for (const line of clubLines) {
    y += LINE.club;
    ctx.fillText(line, PAD, y - 6);
  }

  if (c.organisers) {
    ctx.fillStyle = INK.secondary;
    ctx.font = `400 14px ${SANS}`;
    y += LINE.small + 4;
    ctx.fillText(fit(ctx, c.organisers, inner), PAD, y - 4);
  }

  if (hasFacts) {
    y += 20;
    const top = y;
    const panelH = 16
      + (whenLines.length ? LINE.small + whenLines.length * LINE.fact : 0)
      + (whenLines.length && whereLines.length ? 12 : 0)
      + (whereLines.length ? LINE.small + whereLines.length * LINE.fact + addressLines.length * LINE.small : 0)
      + 16;
    ctx.fillStyle = INK.panel;
    roundRect(ctx, PAD, top, inner, panelH, 12);
    ctx.fill();
    y = top + 16;
    const x = PAD + 12;
    const label = (text: string) => {
      ctx.fillStyle = INK.muted;
      ctx.font = `600 10px ${MONO}`;
      y += 12;
      ctx.fillText(text.toUpperCase(), x, y);
      y += LINE.small - 12;
    };
    const fact = (lines: string[]) => {
      ctx.fillStyle = INK.ink;
      ctx.font = `600 15px ${SANS}`;
      for (const line of lines) {
        y += LINE.fact;
        ctx.fillText(line, x, y - 5);
      }
    };
    if (whenLines.length) {
      label(c.whenLabel);
      fact(whenLines);
    }
    if (whenLines.length && whereLines.length) y += 12;
    if (whereLines.length) {
      label(c.whereLabel);
      fact(whereLines);
      ctx.fillStyle = INK.secondary;
      ctx.font = `400 13px ${SANS}`;
      for (const line of addressLines) {
        y += LINE.small;
        ctx.fillText(line, x, y - 4);
      }
    }
    y = top + panelH;
  }

  // The QR, centred, on WHOLE DEVICE PIXELS: drawn in the scaled space, a
  // square at a fractional position antialiases its edges, and the hairline
  // seams between squares are enough to stop a decoder reading the code.
  y += 24;
  const cell = Math.floor((QR_PX * SCALE) / c.qr.size);
  const drawn = cell * c.qr.size;
  const qx = Math.round((W * SCALE - drawn) / 2);
  const qy = Math.round(y * SCALE + (QR_PX * SCALE - drawn) / 2);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = INK.ink;
  for (let row = 0; row < c.qr.size; row += 1) {
    const cells = c.qr.data[row]!;
    // One rectangle per run of dark squares, so a row has no inner edges at all.
    for (let col = 0; col < c.qr.size; ) {
      if (!cells[col]) {
        col += 1;
        continue;
      }
      let end = col;
      while (end < c.qr.size && cells[end]) end += 1;
      ctx.fillRect(qx + col * cell, qy + row * cell, (end - col) * cell, cell);
      col = end;
    }
  }
  ctx.restore();
  y += QR_PX + 12;

  ctx.textAlign = 'center';
  ctx.fillStyle = INK.secondary;
  ctx.font = `500 13px ${SANS}`;
  y += 13;
  ctx.fillText(fit(ctx, c.scanLine, inner), W / 2, y);
  y += LINE.small - 13;

  y += 16 + 12;
  ctx.fillStyle = INK.muted;
  ctx.font = `400 12px ${SANS}`;
  ctx.fillText(fit(ctx, c.codeLine, inner), W / 2, y);
  y += LINE.small - 12 + 24;
  ctx.fillStyle = INK.ink;
  ctx.font = `700 22px ${MONO}`;
  ctx.fillText(c.code, W / 2, y);
  y += 6;

  y += 20 + 12;
  ctx.fillStyle = INK.muted;
  ctx.font = `400 12px ${SANS}`;
  ctx.fillText(fit(ctx, c.onceLine, inner), W / 2, y);
  y += LINE.small - 12;

  y += 20 + 12;
  ctx.fillStyle = INK.accent;
  ctx.font = `700 12px ${DISPLAY}`;
  ctx.fillText(c.appName, W / 2, y);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}
