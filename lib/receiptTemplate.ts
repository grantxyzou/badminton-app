/**
 * Pure receipt-template helpers. No DOM, no fetch — easy to unit-test.
 *
 * Receipt is rendered both as plain text (clipboard-friendly) and as a 390×520
 * canvas image (shareable to WeChat/iMessage). The text format is the source
 * of truth; the image renders the same content with design-system fonts.
 */

import { CLUB_TIME_ZONE, fmtMoney } from './fmt';

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
  /** The organiser's fee per player inside `costPerPerson` (docs/plans/organiser-fee.md).
   *  Absent / 0 = none; when present the receipt shows it as its own line. */
  organiserFee?: number;
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

// The date reads on the club's clock (`CLUB_TIME_ZONE`), on the receipt AND
// in the memo people type into their e-transfer: on a UTC device a Thursday
// 7 PM session read "Fri, Nov 20" until 2026-11-12.
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

function shortDate(dateIso: string): string {
  if (!dateIso) return '';
  try {
    return new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: CLUB_TIME_ZONE });
  } catch {
    return dateIso.slice(0, 10);
  }
}

function fillMemo(template: string, dateText: string, name: string, clubName?: string): string {
  return template
    .replace(/\{date\}/g, dateText)
    .replace(/\{name\}/g, name)
    // An unknown club collapses to nothing rather than to a placeholder or to
    // some other club's name — a memo reading "Sep 12 - Lin" is merely terse,
    // where one naming the wrong club is wrong about who is being paid. The
    // tidy-up keeps the leading space from surviving the substitution.
    .replace(/\{club\}/g, clubName?.trim() ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function fmtMemo(template: string, dateIso: string, name: string, clubName?: string): string {
  return fillMemo(template, shortDate(dateIso), name, clubName);
}

/** Nights named in a member's memo before the rest are counted as "& N more". */
const MEMO_MAX_DATES = 3;
/** A finished racket in the memo (Grant, 2026-11-23: "Stringing service"). */
const MEMO_STRINGING = 'Stringing service';

/**
 * The memo ONE member pastes into their e-transfer for everything they owe
 * (docs/plans/payment-order.md): the club's own template (or the default
 * below) with `{date}` as the nights owed, oldest first, at most three and
 * then "& N more", and "Stringing service" for a finished racket, after a
 * comma ("Sep 10, Sep 17, Sep 24 & 2 more, Stringing service"). With the default
 * template the name comes LAST, after " - ", which is where `memoRosterName`
 * (`lib/paymentsInbox.ts`) reads it back from the bank's email. A memo is a
 * weak clue, never proof of who paid (F18).
 */
export function memberMemo(input: { template?: string | null; club?: string; name: string; dates: readonly string[]; stringing: boolean }): string | null {
  const name = input.name.trim();
  if (!name) return null;
  const days = [...input.dates]
    .filter((d) => Number.isFinite(Date.parse(d)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .map(shortDate);
  const unique = days.filter((d, i) => days.indexOf(d) === i);
  const named = unique.slice(0, MEMO_MAX_DATES).join(', ');
  const more = unique.length > MEMO_MAX_DATES ? ` & ${unique.length - MEMO_MAX_DATES} more` : '';
  const dateText = [named ? `${named}${more}` : '', input.stringing ? MEMO_STRINGING : ''].filter(Boolean).join(', ');
  return fillMemo(input.template?.trim() || DEFAULT_MEMO, dateText, name, input.club) || null;
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
    `(${courtLabel} · ${playerLabel} · ${fmtMoney(totalCost)} total${
      (input.breakdown?.organiserFee ?? 0) > 0 ? ` · includes a ${fmtMoney(input.breakdown!.organiserFee!)} organiser fee each` : ''
    })`,
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
/** One breakdown row, the gap a rule adds above one, and one pay-to item. */
const ROW_H = 18 + 4;
const RULE_GAP = 2 + 6;
const ITEM_H = 14 + 3 + 19;
/** The footer's band at the bottom: "Thanks for playing" sits 20px above the edge. */
const FOOTER_H = 44;

/**
 * How tall the image must be to hold everything: RECEIPT_H (3:4) unless the
 * content needs more. Only an organiser fee (docs/plans/organiser-fee.md) with
 * a Wealthsimple handle does today — two more breakdown rows and a third
 * pay-to item would otherwise run into the footer.
 */
export function receiptHeight(input: ReceiptInput): number {
  const rows = breakdownRows(input);
  const rowsH = rows.reduce((h, r) => h + ROW_H + (r.ruleAbove ? RULE_GAP : 0), 0);
  const items = payToItems(input).length;
  const boxH = 12 * 2 + items * ITEM_H + (items - 1) * 8;
  return Math.max(RECEIPT_H, BAND_H + 18 + rowsH + 8 + boxH + FOOTER_H);
}

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
  const fee = b?.organiserFee ?? 0;
  if (fee > 0) {
    // The cost share and the organiser's fee on their own lines, so a player
    // can see which part is the night's cost and which is the organiser's.
    const share = Math.round((input.costPerPerson - fee) * 100) / 100;
    rows.push({ label: n > 1 ? `Split ${n} ways` : 'Cost share', amount: `${fmtMoney(share)} each` });
    rows.push({ label: 'Organiser fee', amount: `${fmtMoney(fee)} each` });
    rows.push({ label: 'Per person', amount: fmtMoney(input.costPerPerson), strong: true, accent: true, ruleAbove: true });
    return rows;
  }
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
  const H = receiptHeight(input);
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
      y += RULE_GAP - 2;
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
    y += ROW_H;
  }
  ctx.textAlign = 'left';

  // The pay-to box.
  const items = payToItems(input);
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

/** One side of the string bed, drawn like the bench row and the email: M or C,
 *  a colour dot (null: none given), the string and its tension. */
export interface ReceiptSide {
  letter: string;
  string: string;
  /** A hex fill, or null for a hollow dot. */
  colour: string | null;
  /** "26 lb", in the stringer's language. */
  tension: string;
  /** A custom tension pair: amber, as the app draws it. */
  custom: boolean;
}

/** What the image says, in the stringer's language (the sheet passes `t()`
 *  words in), so the drawing knows nothing about i18n or about jobs. It is
 *  the email's racket card on paper (docs/plans/branded-emails.md): the
 *  reference numbers across the top, the render beside the racket's spec,
 *  and the total once. */
export interface StringingReceiptInput {
  clubName: string;
  /** "Stringing receipt" or "Invoice". */
  title: string;
  /** The invoice number top left (an invoice only), the job number top right. */
  refs: { left?: { label: string; value: string }; right: { label: string; value: string } };
  /** "For Sam". */
  forLine: string;
  racket: { label: string; name: string; image: CanvasImageSource | null };
  strings: { label: string; tags: { text: string; warn: boolean }[]; sides: [ReceiptSide, ReceiptSide] };
  /** Dates: "Ready by", "Dropped off". */
  facts: { label: string; value: string }[];
  totalLabel: string;
  /** "$34", or the word for an unpriced job ("Ask"). */
  total: string;
  /** "Pay at pickup, to your stringer…", or "Paid". */
  note: string;
}

/** The same words as one sentence, for the preview's alt text and a test. */
export function stringingReceiptText(input: StringingReceiptInput): string {
  const { refs, strings } = input;
  return [
    `${input.clubName} · ${input.title}`,
    [refs.left && `${refs.left.label}: ${refs.left.value}`, `${refs.right.label}: ${refs.right.value}`].filter(Boolean).join(' · '),
    input.forLine,
    `${input.racket.label}: ${input.racket.name}`,
    `${strings.label}: ${strings.sides.map((x) => `${x.letter} ${x.string} ${x.tension}`).join(', ')}${strings.tags.length ? ` (${strings.tags.map((x) => x.text).join(', ')})` : ''}`,
    ...input.facts.map((r) => `${r.label}: ${r.value}`),
    `${input.totalLabel}: ${input.total}`,
    input.note,
  ].join('\n');
}

/** Paper and ink. A receipt reads as paper whatever the app's theme; the
 *  racket card takes the email's tints, so the two read as one design. */
const PAPER = {
  table: '#e7e5e0',
  paper: '#fbfaf7',
  shadow: 'rgba(0, 0, 0, 0.12)',
  ink: '#1c1917',
  muted: '#78716c',
  rule: '#d6d3d1',
  accent: '#15803d',
  card: '#f1f5ef',
  tile: '#dcfce7',
  chip: '#ffffff',
  amber: '#b45309',
  amberSoft: '#fef3c7',
  hollow: '#a8a29e',
};

export const STRINGING_RECEIPT_W = 390;
const SR_MARGIN = 18;
const SR_PAD = 24;
const SR_TOOTH = 8;
/** The racket render's tile, and the render inside it (240 × 624 source). */
const TILE_W = 96;
const RENDER_H = 196;

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
 * Draw the stringing receipt or invoice: a sheet of paper with a torn bottom
 * edge. The club and title, the reference numbers (invoice left, job right),
 * "For {name}", the racket card (the render in its green tile beside the
 * racket's name, the strings as M and C with their tags, and the dates), the
 * total once, and how to pay. 390 wide, as tall as its words. Returns a PNG
 * data URL ('' with no 2D context, so the caller keeps its placeholder).
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

  // The card's right column: measured before anything is drawn, because the
  // image is as tall as its words.
  const CARD_PAD = 12;
  const colX = left + CARD_PAD + TILE_W + 12;
  const colW = right - CARD_PAD - colX;
  ctx.font = `700 16px ${f.display}`;
  const nameLines = wrapLines(ctx, input.racket.name, colW);
  ctx.font = `600 11px ${f.sans}`;
  const tagRows: { text: string; warn: boolean; x: number; w: number }[][] = [];
  {
    // Tags sit on the "Strings" label's line and wrap below it.
    ctx.font = `500 10px ${f.mono}`;
    let x = ctx.measureText(input.strings.label.toUpperCase()).width + 8;
    let row: { text: string; warn: boolean; x: number; w: number }[] = [];
    ctx.font = `600 11px ${f.sans}`;
    for (const t of input.strings.tags) {
      const w = ctx.measureText(t.text).width + 14;
      if (row.length && x + w > colW) { tagRows.push(row); row = []; x = 0; }
      if (!row.length && tagRows.length && x + w > colW) x = 0;
      row.push({ ...t, x, w });
      x += w + 5;
    }
    if (row.length) tagRows.push(row);
  }
  const LABEL_H = 14;
  const SIDE_H = 24;
  const FACT_H = LABEL_H + 18;
  const stringsH = LABEL_H + Math.max(0, tagRows.length - 1) * 20 + 4 + SIDE_H * 2;
  const colH = LABEL_H + nameLines.length * 20 + 10 + stringsH + 8 + input.facts.length * (FACT_H + 8);
  const cardH = Math.max(colH, RENDER_H + 8) + CARD_PAD * 2;

  ctx.font = `400 13px ${f.sans}`;
  const noteLines = wrapLines(ctx, input.note, inner);
  const height =
    SR_MARGIN + SR_PAD + 22 + 20 + 12 + 34 + 12 + 26 + 10 + cardH + 18 + 14 + 40 + 10 + noteLines.length * 19 + SR_PAD + SR_TOOTH + SR_MARGIN;

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

  const label = (text: string, x: number, atY: number, align: CanvasTextAlign = 'left', colour = PAPER.muted) => {
    ctx.font = `500 10px ${f.mono}`;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.fillText(text.toUpperCase(), x, atY);
    ctx.textAlign = 'left';
  };
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

  let y = SR_MARGIN + SR_PAD;

  // Club and title.
  ctx.fillStyle = PAPER.ink;
  fitFont(ctx, input.clubName, 700, 19, 13, f.display, inner);
  ctx.fillText(input.clubName, left, y + 16);
  y += 22;
  ctx.fillStyle = PAPER.muted;
  ctx.font = `500 13px ${f.sans}`;
  ctx.fillText(input.title, left, y + 14);
  y += 20 + 12;

  // The reference numbers: the invoice top left, the job top right.
  const ref = (r: { label: string; value: string }, x: number, align: CanvasTextAlign) => {
    label(r.label, x, y + 10, align);
    ctx.font = `600 15px ${f.mono}`;
    ctx.fillStyle = PAPER.ink;
    ctx.textAlign = align;
    ctx.fillText(r.value, x, y + 29);
    ctx.textAlign = 'left';
  };
  if (input.refs.left) ref(input.refs.left, left, 'left');
  ref(input.refs.right, right, 'right');
  y += 34 + 12;
  dashed(y);
  y += 10;

  // Who it is for.
  ctx.fillStyle = PAPER.ink;
  fitFont(ctx, input.forLine, 600, 16, 12, f.sans, inner);
  ctx.fillText(input.forLine, left, y + 16);
  y += 26 + 10;

  // The racket card.
  ctx.fillStyle = PAPER.card;
  roundRect(ctx, left, y, inner, cardH, 14);
  ctx.fill();
  const tileH = cardH - CARD_PAD * 2;
  ctx.fillStyle = PAPER.tile;
  roundRect(ctx, left + CARD_PAD, y + CARD_PAD, TILE_W, tileH, 10);
  ctx.fill();
  if (input.racket.image) {
    const rw = RENDER_H * (240 / 624);
    ctx.drawImage(input.racket.image, left + CARD_PAD + (TILE_W - rw) / 2, y + CARD_PAD + (tileH - RENDER_H) / 2, rw, RENDER_H);
  }

  let cy = y + CARD_PAD + 2;
  label(input.racket.label, colX, cy + 9);
  cy += LABEL_H;
  ctx.fillStyle = PAPER.ink;
  ctx.font = `700 16px ${f.display}`;
  for (const line of nameLines) {
    ctx.fillText(line, colX, cy + 15);
    cy += 20;
  }
  cy += 10;

  // Strings: the label, its tags beside it (wrapping below), then M and C.
  label(input.strings.label, colX, cy + 9);
  tagRows.forEach((row, i) => {
    for (const t of row) {
      const ty = cy + i * 20 - 4;
      ctx.fillStyle = t.warn ? PAPER.amberSoft : PAPER.chip;
      roundRect(ctx, colX + t.x, ty, t.w, 17, 8.5);
      ctx.fill();
      ctx.fillStyle = t.warn ? PAPER.amber : PAPER.muted;
      ctx.font = `600 11px ${f.sans}`;
      ctx.fillText(t.text, colX + t.x + 7, ty + 12.5);
    }
  });
  cy += LABEL_H + Math.max(0, tagRows.length - 1) * 20 + 4;
  for (const side of input.strings.sides) {
    const mid = cy + SIDE_H / 2;
    ctx.fillStyle = PAPER.chip;
    roundRect(ctx, colX, mid - 9, 18, 18, 5);
    ctx.fill();
    ctx.fillStyle = PAPER.muted;
    ctx.font = `700 10px ${f.mono}`;
    ctx.textAlign = 'center';
    ctx.fillText(side.letter, colX + 9, mid + 3.5);
    ctx.textAlign = 'left';
    ctx.beginPath();
    ctx.arc(colX + 30, mid, 5, 0, Math.PI * 2);
    if (side.colour) {
      ctx.fillStyle = side.colour;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    } else {
      ctx.strokeStyle = PAPER.hollow;
    }
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `${side.custom ? 700 : 500} 12px ${f.mono}`;
    const tw = ctx.measureText(side.tension).width;
    ctx.fillStyle = side.custom ? PAPER.amber : PAPER.ink;
    ctx.textAlign = 'right';
    ctx.fillText(side.tension, colX + colW, mid + 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = PAPER.ink;
    fitFont(ctx, side.string, 600, 13, 9, f.sans, colW - 40 - tw - 8);
    ctx.fillText(side.string, colX + 40, mid + 4.5);
    cy += SIDE_H;
  }
  cy += 8;

  for (const fact of input.facts) {
    label(fact.label, colX, cy + 9);
    ctx.fillStyle = PAPER.ink;
    fitFont(ctx, fact.value, 600, 14, 10, f.sans, colW);
    ctx.fillText(fact.value, colX, cy + LABEL_H + 14);
    cy += FACT_H + 8;
  }

  y += cardH + 18;
  dashed(y);
  y += 14;

  // The total, once.
  ctx.fillStyle = PAPER.ink;
  ctx.font = `700 16px ${f.sans}`;
  ctx.fillText(input.totalLabel, left, y + 26);
  ctx.textAlign = 'right';
  ctx.font = `700 28px ${f.display}`;
  ctx.fillText(input.total, right, y + 28);
  ctx.textAlign = 'left';
  y += 40 + 10;

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
