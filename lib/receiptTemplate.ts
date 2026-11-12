/**
 * Pure receipt-template helpers. No DOM, no fetch — easy to unit-test.
 *
 * Receipt is rendered both as plain text (clipboard-friendly) and as a 390×520
 * canvas image (shareable to WeChat/iMessage). The text format is the source
 * of truth; the image renders the same content with design-system fonts.
 */

import { fmtMoney } from './fmt';

export interface ReceiptBreakdown {
  /** What the courts cost in all, and the price of one when known. */
  courtTotal: number;
  costPerCourt?: number;
  /** What the shuttles cost in all, and how many tubes. */
  birdTotal: number;
  tubes?: number;
  /** How many people the total is shared between (the bill's denominator,
   *  which leaves out a player covered by "split it across everyone else"). */
  splitCount: number;
}

export interface ReceiptInput {
  /** Session date — ISO string. */
  datetime: string;
  /** Per-person amount (already rounded). */
  costPerPerson: number;
  /** Number of courts (for totals line). */
  courts: number;
  /** Total cost for the session. */
  totalCost: number;
  /** Active player names (already filtered for waitlist/removed). */
  playerNames: string[];
  /** E-transfer recipient, and the club's Wealthsimple handle when it has one. */
  recipient: { name: string; email: string; wealthsimple?: string };
  /**
   * Where the total came from, for the image's breakdown ("2 courts × $48",
   * "1 tube of shuttles", "Split 6 ways"). Optional: a receipt built before it
   * existed, or by a caller that cannot say, draws the total alone.
   */
  breakdown?: ReceiptBreakdown;
  /** Memo template. `{date}`, `{name}` and `{club}` are interpolated. */
  memoTemplate?: string;
  /**
   * The club this bill is from, for `{club}` in the memo.
   *
   * Optional and additive: absent means the token collapses to nothing, which
   * is what every caller written before multi-group does. It is the CLUB and
   * never the product — see `DEFAULT_MEMO`.
   */
  clubName?: string;
  /** Optional admin note. */
  note?: string;
}

export interface IndividualReceiptInput extends ReceiptInput {
  /** Player the receipt is addressed to (used in memo + greeting). */
  playerName: string;
}

/**
 * The club's clock. A session date reads in Vancouver time whatever zone the
 * phone is in (CLAUDE.md, "Session times display in Vancouver time"): without
 * it a Thursday 7 PM session formatted on a UTC device read "Fri, Nov 20",
 * on the receipt AND in the memo people type into their e-transfer.
 */
const CLUB_TIME_ZONE = 'America/Vancouver';

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: CLUB_TIME_ZONE,
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtMemo(template: string, dateIso: string, name: string, clubName?: string): string {
  const dateShort = (() => {
    if (!dateIso) return '';
    try {
      return new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: CLUB_TIME_ZONE });
    } catch {
      return dateIso.slice(0, 10);
    }
  })();
  return template
    .replace(/\{date\}/g, dateShort)
    .replace(/\{name\}/g, name)
    // An unknown club collapses to nothing rather than to a placeholder or to
    // some other club's name — a memo reading "Sep 12 - Lin" is merely terse,
    // where one naming the wrong club is wrong about who is being paid. The
    // tidy-up keeps the leading space from surviving the substitution.
    .replace(/\{club\}/g, clubName?.trim() ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * The memo when a club has not set one, and the leading word is a CLUB name.
 *
 * This string ends up in someone's bank transfer, next to money, read by a
 * person deciding whether they recognise the payment. That makes it the club's
 * name and never the product's: "Acme Badminton 09-12 - Lin" tells the payer
 * what they are paying for, while the app's name tells them which software the
 * organiser happens to use, which they have no reason to care about.
 *
 * The club normally supplies its own through `recipient.memo`, which an admin
 * edits in settings; this is only the fallback for a club that never set one.
 * `{club}` is substituted by `fmtMemo` alongside `{date}` and `{name}`, so a
 * caller that knows the club gets it and one that does not falls back to the
 * bare date-and-name form rather than printing another club's name.
 */
const DEFAULT_MEMO = '{club} {date} - {name}';

/** Group-format text: posted to the friend-group chat once the bill is sent.
 *  Lead with the headline ("$X each"), keep the bookkeeping in a parenthetical
 *  at the bottom. People stop reading after the dollar amount; everything
 *  load-bearing should be before that line. */
export function renderGroupText(input: ReceiptInput): string {
  const { datetime, costPerPerson, courts, totalCost, playerNames, recipient, memoTemplate, note } = input;
  const memo = fmtMemo(memoTemplate ?? DEFAULT_MEMO, datetime, '{your name}', input.clubName);
  const courtLabel = `${courts} court${courts === 1 ? '' : 's'}`;
  const playerLabel = `${playerNames.length} of us`;
  const lines = [
    `Badminton on ${fmtDate(datetime)} was ${fmtMoney(costPerPerson)} each.`,
    '',
    `E-transfer me at ${recipient.email}`,
    ...(recipient.wealthsimple ? [`Or Wealthsimple: ${recipient.wealthsimple}`] : []),
    `Memo: ${memo}`,
    '',
    `(${courtLabel} · ${playerLabel} · ${fmtMoney(totalCost)} total)`,
  ];
  if (note?.trim()) {
    lines.push('', note.trim());
  }
  return lines.join('\n');
}

/** Individual-format text: friendly nudge for a single player. */
export function renderIndividualText(input: IndividualReceiptInput): string {
  const { datetime, costPerPerson, recipient, memoTemplate, playerName, note } = input;
  const memo = fmtMemo(memoTemplate ?? DEFAULT_MEMO, datetime, playerName, input.clubName);
  const lines = [
    `Hey ${playerName} — badminton on ${fmtDate(datetime)} was ${fmtMoney(costPerPerson)}.`,
    '',
    `E-transfer me at ${recipient.email}`,
    ...(recipient.wealthsimple ? [`Or Wealthsimple: ${recipient.wealthsimple}`] : []),
    `Memo: ${memo}`,
  ];
  if (note?.trim()) {
    lines.push('', note.trim());
  }
  lines.push('', 'Thanks!');
  return lines.join('\n');
}

/** The app's own faces. next/font serves them under generated family names, so
 *  a literal 'IBM Plex Sans' would fall through to the system face; the type
 *  tokens on <html> carry the real names (the same reading as the Equipment
 *  share image, `lib/setupShareCanvas.ts`). */
interface Faces { display: string; sans: string; mono: string }
const FALLBACK_FACES: Faces = {
  display: "'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
};
function readFaces(): Faces {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK_FACES;
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).replace(/\s+/g, ' ').trim() || fallback;
  return { display: read('--font-display', FALLBACK_FACES.display), sans: read('--font-sans', FALLBACK_FACES.sans), mono: read('--font-mono', FALLBACK_FACES.mono) };
}

/** The image's own palette (design F4, 2026-11-10). A canvas cannot read CSS
 *  custom properties, so these are the values the tokens hold in dark mode. */
const INK = {
  ground: '#100F0F',
  bandFrom: '#15803d',
  bandTo: '#16a34a',
  white: '#ffffff',
  body: 'rgba(255, 255, 255, 0.88)',
  label: 'rgba(255, 255, 255, 0.6)',
  quiet: 'rgba(255, 255, 255, 0.55)',
  rule: 'rgba(255, 255, 255, 0.22)',
  well: 'rgba(255, 255, 255, 0.06)',
  each: '#86efac',
};

export const RECEIPT_W = 390;
export const RECEIPT_H = 520;
const PAD = 24;
const BAND_H = 198;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The breakdown's rows, top to bottom. Pure, so the words can be tested
 *  without a canvas. A row with nothing to say (no shuttles that night) is left
 *  out; with no breakdown at all the image shows the total and the share. */
export function breakdownRows(input: ReceiptInput): { label: string; amount: string; strong?: boolean; accent?: boolean; ruleAbove?: boolean }[] {
  const rows: { label: string; amount: string; strong?: boolean; accent?: boolean; ruleAbove?: boolean }[] = [];
  const b = input.breakdown;
  if (b && b.courtTotal > 0) {
    const courts = input.courts > 0 ? plural(input.courts, 'court', 'courts') : 'Courts';
    rows.push({
      label: b.costPerCourt && input.courts > 0 ? `${courts} × ${fmtMoney(b.costPerCourt)}` : courts,
      amount: fmtMoney(b.courtTotal),
    });
  }
  if (b && b.birdTotal > 0) {
    rows.push({
      label: b.tubes && b.tubes > 0 ? `${plural(b.tubes, 'tube', 'tubes')} of shuttles` : 'Shuttles',
      amount: fmtMoney(b.birdTotal),
    });
  }
  rows.push({ label: 'Total', amount: fmtMoney(input.totalCost), strong: true, ruleAbove: rows.length > 0 });
  const n = b?.splitCount ?? 0;
  rows.push(n > 1
    ? { label: `Split ${n} ways`, amount: `${fmtMoney(input.costPerPerson)} each`, strong: true, accent: true }
    : { label: 'Per person', amount: fmtMoney(input.costPerPerson), strong: true, accent: true });
  return rows;
}

/** The pay-to box's items: always the e-transfer address and the memo, and
 *  the Wealthsimple handle between them when the club has one. */
export function payToItems(input: ReceiptInput): { label: string; value: string }[] {
  const memo = fmtMemo(input.memoTemplate ?? DEFAULT_MEMO, input.datetime, 'your name', input.clubName);
  return [
    { label: 'E-transfer to:', value: input.recipient.email },
    ...(input.recipient.wealthsimple ? [{ label: 'WS transfer:', value: input.recipient.wealthsimple }] : []),
    { label: 'Please include a memo:', value: memo },
  ];
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

/** Set `font` at the largest size from `max` down to `min` that fits `width`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, family: string, width: number) {
  let size = max;
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > width) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${family}`;
  }
}

/**
 * Draw the group receipt (design F4, chosen on the design canvas 2026-11-10):
 * a green band holding the club, the date, the logo and the big "$18.50 each",
 * then the cost breakdown, then the pay-to box, then "Thanks for playing".
 * 390×520 (3:4), so a chat shows it whole. Returns a PNG data URL.
 * Caller should `await document.fonts.ready` before invoking, and pass the
 * app icon once it has loaded (drawn without it until then).
 */
export function renderGroupCanvas(
  input: ReceiptInput,
  canvas: HTMLCanvasElement,
  logo: (CanvasImageSource & { width: number; height: number }) | null = null,
): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const W = RECEIPT_W;
  const H = RECEIPT_H;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';
  const f = readFaces();

  // Ground, then the green band across the top.
  ctx.fillStyle = INK.ground;
  ctx.fillRect(0, 0, W, H);
  const band = ctx.createLinearGradient(0, 0, W, BAND_H);
  band.addColorStop(0, INK.bandFrom);
  band.addColorStop(1, INK.bandTo);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, BAND_H);

  // Club and date, with the logo at the top right.
  const LOGO = 40;
  ctx.fillStyle = INK.white;
  ctx.textAlign = 'left';
  const head = [input.clubName?.trim(), fmtDate(input.datetime)].filter(Boolean).join(' · ');
  fitFont(ctx, head, 600, 15, 12, f.sans, W - PAD * 2 - LOGO - 12);
  ctx.fillText(head, PAD, PAD + 14 + 11);
  if (logo && logo.width > 0) {
    ctx.save();
    roundRect(ctx, W - PAD - LOGO, PAD, LOGO, LOGO, 10);
    ctx.clip();
    ctx.drawImage(logo, W - PAD - LOGO, PAD, LOGO, LOGO);
    ctx.restore();
  }

  // The big amount, sitting on the band's bottom padding.
  const amount = fmtMoney(input.costPerPerson);
  const amountBase = BAND_H - PAD - 6;
  fitFont(ctx, amount, 700, 64, 40, f.display, W - PAD * 2 - 70);
  ctx.fillText(amount, PAD, amountBase);
  const aw = ctx.measureText(amount).width;
  ctx.font = `600 20px ${f.sans}`;
  ctx.fillText('each', PAD + aw + 10, amountBase);

  // The breakdown: label on the left, amount on the right.
  let y = BAND_H + 18;
  for (const row of breakdownRows(input)) {
    if (row.ruleAbove) {
      y += 2;
      ctx.fillStyle = INK.rule;
      ctx.fillRect(PAD, y, W - PAD * 2, 1);
      y += 6;
    }
    const base = y + 14;
    ctx.font = `${row.strong ? 700 : 400} 15px ${f.sans}`;
    ctx.fillStyle = row.strong ? INK.white : INK.body;
    ctx.textAlign = 'left';
    ctx.fillText(row.label, PAD, base);
    ctx.font = `${row.strong ? 700 : 600} 15px ${f.sans}`;
    ctx.fillStyle = row.accent ? INK.each : INK.white;
    ctx.textAlign = 'right';
    ctx.fillText(row.amount, W - PAD, base);
    y += 18 + 4;
  }
  ctx.textAlign = 'left';

  // The pay-to box.
  const items = payToItems(input);
  const ITEM_H = 14 + 3 + 19;
  const boxTop = y + 8;
  const boxH = 12 * 2 + items.length * ITEM_H + (items.length - 1) * 8;
  ctx.fillStyle = INK.well;
  roundRect(ctx, PAD, boxTop, W - PAD * 2, boxH, 16);
  ctx.fill();
  let iy = boxTop + 12;
  const inner = W - PAD * 2 - 32;
  for (const item of items) {
    ctx.fillStyle = INK.label;
    ctx.font = `600 12px ${f.sans}`;
    ctx.fillText(item.label, PAD + 16, iy + 11);
    ctx.fillStyle = INK.white;
    // A long address shrinks to fit the box rather than run past its edge.
    fitFont(ctx, item.value, 600, 16, 8, f.mono, inner);
    ctx.fillText(item.value, PAD + 16, iy + 14 + 3 + 15);
    iy += ITEM_H + 8;
  }

  // Footer.
  ctx.fillStyle = INK.quiet;
  ctx.font = `400 13px ${f.sans}`;
  ctx.textAlign = 'center';
  ctx.fillText('Thanks for playing', W / 2, H - 20);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}


/* ------------------------------------------------------------------------ */
/* The WALK-UP'S STRINGING RECEIPT (docs/plans/stringing-walk-ups.md,        */
/* 2026-11-12). A walk-up has no app; the stringer texts, AirDrops or saves  */
/* this image for them from the job page. It names the person and the job,   */
/* NEVER their contact. Drawn here, beside the session receipt, because this */
/* file is already exempt from the token guardrail for the same reason: a    */
/* canvas `fillStyle` takes a colour string, and var() means nothing there.  */
/* ------------------------------------------------------------------------ */

/** What the image says, in the stringer's language (the sheet passes `t()`
 *  words in), so the drawing knows nothing about i18n or about jobs. */
export interface StringingReceiptInput {
  clubName: string;
  /** "Stringing receipt". */
  title: string;
  jobNo: string;
  /** "For Sam". */
  forLine: string;
  rows: { label: string; value: string }[];
  totalLabel: string;
  /** "$34", or the word for an unpriced job ("Ask"). */
  total: string;
  /** "Pay at pickup, to your stringer…", or "Paid". */
  note: string;
}

/** The same words as one sentence, for the preview's alt text and a test. */
export function stringingReceiptText(input: StringingReceiptInput): string {
  return [
    `${input.clubName} · ${input.title} · ${input.jobNo}`,
    input.forLine,
    ...input.rows.map((r) => `${r.label}: ${r.value}`),
    `${input.totalLabel}: ${input.total}`,
    input.note,
  ].join('\n');
}

/** Paper and ink. A receipt reads as paper whatever the app's theme. */
const PAPER = {
  table: '#e7e5e0',
  paper: '#fbfaf7',
  shadow: 'rgba(0, 0, 0, 0.12)',
  ink: '#1c1917',
  muted: '#78716c',
  rule: '#d6d3d1',
  accent: '#15803d',
};

export const STRINGING_RECEIPT_W = 390;
const SR_MARGIN = 18;
const SR_PAD = 24;
const SR_TOOTH = 8;

/** Break `text` into lines no wider than `width` at the current font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(tryLine).width > width) {
      lines.push(line);
      line = w;
    } else {
      line = tryLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw the stringing receipt (job page canvas frame, 2026-11-12): a sheet of
 * paper with a torn bottom edge — club and "Stringing receipt" with the job
 * number top right, "For {name}", the spec rows, a Total, and how to pay.
 * 390 wide, as tall as its words. Returns a PNG data URL ('' with no 2D
 * context, so the caller keeps its placeholder rather than a blank image).
 */
export function renderStringingReceiptCanvas(input: StringingReceiptInput, canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const f = readFaces();
  const W = STRINGING_RECEIPT_W;
  const paperX = SR_MARGIN;
  const paperW = W - SR_MARGIN * 2;
  const inner = paperW - SR_PAD * 2;
  const left = paperX + SR_PAD;
  const right = paperX + paperW - SR_PAD;

  // Measure the note first: the image is as tall as its words.
  ctx.font = `400 13px ${f.sans}`;
  const noteLines = wrapLines(ctx, input.note, inner);
  const ROW_H = 28;
  const height =
    SR_MARGIN + SR_PAD + 22 + 20 + 22 + 24 + 14 + input.rows.length * ROW_H + 18 + 34 + 16 + noteLines.length * 19 + SR_PAD + SR_TOOTH + SR_MARGIN;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = W * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = PAPER.table;
  ctx.fillRect(0, 0, W, height);

  // The paper, with a zig-zag torn edge along the bottom.
  const paperBottom = height - SR_MARGIN - SR_TOOTH;
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(paperX, SR_MARGIN);
    ctx.lineTo(paperX + paperW, SR_MARGIN);
    ctx.lineTo(paperX + paperW, paperBottom);
    const teeth = Math.round(paperW / 14);
    const step = paperW / teeth;
    for (let i = teeth - 1; i >= 0; i--) {
      ctx.lineTo(paperX + i * step + step / 2, paperBottom + SR_TOOTH);
      ctx.lineTo(paperX + i * step, paperBottom);
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.shadowColor = PAPER.shadow;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = PAPER.paper;
  outline();
  ctx.fill();
  ctx.restore();

  let y = SR_MARGIN + SR_PAD;

  // Club and title on the left, the job number on the right.
  ctx.font = `700 15px ${f.mono}`;
  const jobW = ctx.measureText(input.jobNo).width;
  ctx.fillStyle = PAPER.ink;
  ctx.textAlign = 'right';
  ctx.fillText(input.jobNo, right, y + 16);
  ctx.textAlign = 'left';
  fitFont(ctx, input.clubName, 700, 19, 13, f.display, inner - jobW - 12);
  ctx.fillText(input.clubName, left, y + 16);
  y += 22;
  ctx.fillStyle = PAPER.muted;
  ctx.font = `500 13px ${f.sans}`;
  ctx.fillText(input.title, left, y + 14);
  y += 20;

  const dashed = (atY: number) => {
    ctx.save();
    ctx.strokeStyle = PAPER.rule;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, atY);
    ctx.lineTo(right, atY);
    ctx.stroke();
    ctx.restore();
  };
  y += 10;
  dashed(y);
  y += 12;

  // Who it is for.
  ctx.fillStyle = PAPER.ink;
  fitFont(ctx, input.forLine, 600, 16, 12, f.sans, inner);
  ctx.fillText(input.forLine, left, y + 16);
  y += 24 + 14;

  // The spec rows: label left, value right, the value shrinking to fit.
  for (const row of input.rows) {
    const base = y + 15;
    ctx.font = `400 14px ${f.sans}`;
    ctx.fillStyle = PAPER.muted;
    ctx.textAlign = 'left';
    ctx.fillText(row.label, left, base);
    const labelW = ctx.measureText(row.label).width;
    ctx.fillStyle = PAPER.ink;
    ctx.textAlign = 'right';
    fitFont(ctx, row.value, 600, 14, 9, f.sans, inner - labelW - 16);
    ctx.fillText(row.value, right, base);
    ctx.textAlign = 'left';
    y += ROW_H;
  }

  y += 4;
  dashed(y);
  y += 14;

  // Total.
  ctx.fillStyle = PAPER.ink;
  ctx.font = `700 16px ${f.sans}`;
  ctx.textAlign = 'left';
  ctx.fillText(input.totalLabel, left, y + 24);
  ctx.textAlign = 'right';
  ctx.font = `700 26px ${f.mono}`;
  ctx.fillText(input.total, right, y + 26);
  ctx.textAlign = 'left';
  y += 34 + 16;

  // How to pay (or "Paid").
  ctx.font = `400 13px ${f.sans}`;
  ctx.fillStyle = PAPER.muted;
  for (const line of noteLines) {
    ctx.fillText(line, left, y + 13);
    y += 19;
  }

  // A thin green edge along the top, the club's colour on paper.
  ctx.fillStyle = PAPER.accent;
  ctx.fillRect(paperX, SR_MARGIN, paperW, 3);

  return canvas.toDataURL('image/png');
}
