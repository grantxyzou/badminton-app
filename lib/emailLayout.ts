/**
 * THE EMAIL FRAME (docs/plans/branded-emails.md): every HTML email BPM sends
 * is built from these pieces, so they look like one product and cannot drift.
 *
 *   emailHtml      the whole message: the dark header with the app's mark,
 *                  the body blocks, the footer
 *   racketCard     a job's racket render beside its spec, strings as M and C,
 *                  and the cost ONCE at the bottom
 *   heading / para / muted / button / signoff   the small blocks between
 *   linkLine / codeBox / clubChip / messageBox / detailList   the account
 *                  emails' and the problem report's blocks
 *
 * Mail clients are not browsers: no CSS variables, no flexbox or grid in
 * Outlook, and Gmail drops a <style> block's classes. So the layout is tables
 * and every style is inline, and colours are literal hex: the one place in the
 * app where a design token cannot reach (the lint escape hatch below says so).
 *
 * Pure: nothing here reads the database or the environment. A sender passes
 * the origin pictures load from (`outboundOriginOrNull()`), or null for none.
 */
import { jobSides } from './stringingSides';
import { reelColourFill } from './stringShelf';
import { isStringColourId, isCustomColourId, comboParts, colourIdOf, type CustomColour } from './stringPalette';
import { assetUrl } from './assetUrl';
import { racketEmailSrc, EMAIL_RACKET_GROUND } from './racketLook';
import { APP_NAME } from './brand';

/* eslint-disable no-restricted-syntax -- an email cannot read the app's CSS
   variables: these are the BPM tokens (globals.css, light) written out, the
   only form a mail client renders. */
const C = {
  page: '#f4f2ee',
  card: '#ffffff',
  head: '#100F0F',
  headInk: '#e2e8f0',
  logo: '#4ade80',
  ink: '#1a2332',
  muted: '#4d6b57',
  tint: '#f1f5ef',
  accent: '#15803d',
  accentSoft: '#dcfce7',
  amber: '#b45309',
  amberSoft: '#fef3c7',
  hollow: '#9ca3af',
};
/* eslint-enable no-restricted-syntax */

const DISPLAY = "'Space Grotesk','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const SANS = "'IBM Plex Sans','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const e = escapeHtml;

/** An asset URL made absolute, or null when there is no origin to load it from. */
function absolute(origin: string | null, u: string): string | null {
  if (/^https?:\/\//.test(u)) return u;
  return origin ? `${origin}${u.startsWith('/') ? '' : '/'}${u}` : null;
}

/** The racket picture a job's email shows (`racketEmailSrc`: its own, or the matte black one, on the tile's green). */
export function racketPictureUrl(origin: string | null, catalogId: string | null): string | null {
  return absolute(origin, racketEmailSrc(catalogId));
}

// ── Small blocks ─────────────────────────────────────────────────────────────

export function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-family:${DISPLAY};font-size:26px;line-height:1.15;font-weight:700;color:${C.ink}">${e(text)}</h1>`;
}

export function para(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.55;color:${C.ink}">${e(text)}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.muted}">${e(text)}</p>`;
}

/** Two lines, the club's sign-off: "See you on the court. / — BPM Core". */
export function signoff(line: string, club: string): string {
  return `<p style="margin:0 0 4px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.ink}">${e(line)}<br>— ${e(club)}</p>`;
}

/** The one action in an email: full width, like the app's main button
 *  (`.btn-primary`). A bulletproof table button, so Outlook draws it too. */
export function button(label: string, url: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px"><tr>` +
    `<td align="center" style="border-radius:12px;background:${C.accent}">` +
    `<a href="${e(url)}" style="display:block;padding:15px 24px;font-family:${DISPLAY};font-size:17px;font-weight:700;color:#ffffff;text-align:center;text-decoration:none;border-radius:12px">${e(label)}</a>` +
    `</td></tr></table>`
  );
}

/** The link a button opens, written out under it for a mail app that drops
 *  the button, and so a careful person can see where it goes. */
export function linkLine(url: string): string {
  return `<p style="margin:-4px 0 16px;font-family:${MONO};font-size:12px;line-height:1.5;color:${C.muted};word-break:break-all">${e(url)}</p>`;
}

/** A one-time code, the loudest thing in its email: it is why it was opened. */
export function codeBox(code: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr>` +
    `<td align="center" style="padding:20px 12px 20px 22px;border-radius:16px;background:${C.tint};font-family:${MONO};font-size:36px;line-height:1;font-weight:700;letter-spacing:.28em;color:${C.accent}">${e(code)}</td>` +
    `</tr></table>`
  );
}

/** The club an email is about, as a small green chip above the heading. */
export function clubChip(name: string): string {
  return (
    `<div style="margin:0 0 12px"><span style="display:inline-block;padding:6px 14px;border-radius:100px;background:${C.accentSoft};font-family:${SANS};font-size:14px;font-weight:600;color:${C.accent}">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${C.accent};margin-right:8px;vertical-align:middle"></span>${e(name)}</span></div>`
  );
}

/** Something a person wrote, quoted as they wrote it: line breaks kept, nothing interpreted. */
export function messageBox(text: string): string {
  return `<div style="margin:0 0 16px;padding:16px 18px;border-radius:16px;background:${C.tint};font-family:${SANS};font-size:15px;line-height:1.55;color:${C.ink};white-space:pre-wrap">${e(text)}</div>`;
}

/** A green check in a circle, above a heading that confirms something landed. */
export function checkMark(): string {
  return `<div style="width:52px;height:52px;line-height:52px;border-radius:26px;background:${C.accentSoft};color:${C.accent};text-align:center;font-family:${SANS};font-size:28px;font-weight:700;margin:0 0 14px">&#10003;</div>`;
}

/** Money that came in: green, where money owed is amber. The one place the total is drawn. */
export function paidBox(label: string, amount: string, sub: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px"><tr>` +
    `<td style="padding:18px 20px;border-radius:16px;background:${C.accentSoft}">` +
    `<div style="font-family:${MONO};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${C.accent}">${e(label)}</div>` +
    `<div style="margin-top:4px;font-family:${DISPLAY};font-size:38px;line-height:1;font-weight:700;color:${C.accent}">${e(amount)}</div>` +
    `<div style="margin-top:6px;font-family:${SANS};font-size:13px;color:${C.muted}">${e(sub)}</div>` +
    `</td></tr></table>`
  );
}

/** Label and value rows in a tinted box: a report's context, or a receipt's
 *  lines with `amounts` (the values right-aligned, so the money lines up). */
export function detailList(rows: Array<{ label: string; value: string; mono?: boolean }>, opts: { amounts?: boolean } = {}): string {
  const align = opts.amounts ? 'right' : 'left';
  const tr = rows
    .map(
      (r) =>
        `<tr><td valign="top" style="padding:4px 16px 4px 0;font-family:${SANS};font-size:14px;color:${C.muted}${opts.amounts ? '' : ';white-space:nowrap'}">${e(r.label)}</td>` +
        `<td valign="top" align="${align}" style="padding:4px 0;text-align:${align};font-family:${r.mono ? MONO : SANS};font-size:14px;font-weight:600;color:${C.ink};${opts.amounts ? 'white-space:nowrap;font-variant-numeric:tabular-nums' : 'word-break:break-word'}">${e(r.value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;border-radius:16px;background:${C.tint};border-collapse:separate"><tr><td style="padding:12px 18px"><table role="presentation"${opts.amounts ? ' width="100%"' : ''} cellpadding="0" cellspacing="0" border="0">${tr}</table></td></tr></table>`;
}

// ── The racket card ──────────────────────────────────────────────────────────

export interface CardJob {
  racketLabel: string;
  stringLabel: string;
  stringColor?: string | null;
  tensionMains: number;
  tensionCrosses: number;
  ownString?: boolean;
}

export interface CardCost {
  label: string;
  value: string;
  /** Money still owed: amber, as the app draws it. */
  owed?: boolean;
  /** A line under the number ("Your stringer will price it"). */
  note?: string;
}

/** A side's colour as a hex dot, or null for none (or one we cannot draw).
 *  Shared with the receipt picture, which draws the same dots. */
export function swatchHex(id: string | null): string | null {
  if (!id || !(isStringColourId(id) || isCustomColourId(id))) return null;
  const fill = reelColourFill(id);
  return /^#[0-9a-f]{6}$/i.test(fill) ? fill : null;
}

function sideRow(letter: string, string: string, colour: string | null, tension: number, custom: boolean): string {
  const dot = colour
    ? `<div style="width:11px;height:11px;border-radius:6px;background:${colour};box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)"></div>`
    : `<div style="width:9px;height:9px;border-radius:6px;border:1px solid ${C.hollow}"></div>`;
  return (
    `<tr>` +
    `<td width="22" valign="middle" style="padding:3px 6px 3px 0"><div style="width:20px;height:20px;line-height:20px;border-radius:6px;background:${C.card};text-align:center;font-family:${MONO};font-size:11px;font-weight:700;color:${C.muted}">${letter}</div></td>` +
    `<td width="12" valign="middle" style="padding:3px 6px 3px 0">${dot}</td>` +
    `<td valign="middle" style="padding:3px 0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:600;color:${C.ink}">${e(string)}</td>` +
    `<td class="rc-tn" valign="middle" align="right" style="padding:3px 0 3px 8px;white-space:nowrap;font-family:${MONO};font-size:13px;line-height:20px;font-weight:${custom ? 700 : 500};color:${custom ? C.amber : C.ink}">${tension} lb</td>` +
    `</tr>`
  );
}

function label(text: string, extra = ''): string {
  return `<div style="font-family:${MONO};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:${C.muted};margin:0 0 2px">${e(text)}${extra ? `<span style="display:inline-block;width:8px"></span>${extra}` : ''}</div>`;
}

function tag(text: string, warn: boolean): string {
  return `<span style="display:inline-block;margin:2px 6px 0 0;padding:2px 8px;border-radius:100px;background:${warn ? C.amberSoft : C.card};color:${warn ? C.amber : C.muted};font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0;text-transform:none;vertical-align:middle">${e(text)}</span>`;
}

export type StringTag = 'customTension' | 'twoColour' | 'ownString';

/**
 * The tags beside "Strings": what makes this job unlike a plain restring.
 * Each is a fact the stringer wrote, never a guess. Returned as CODES so the
 * email (English) and the receipt picture (the stringer's language) word them
 * each their own way from one rule. A custom tension is the one warning.
 */
export function stringTags(job: CardJob, customs: readonly CustomColour[] = []): StringTag[] {
  const sides = jobSides(job, customs);
  const out: StringTag[] = [];
  if (sides.customTension) out.push('customTension');
  // Two different strings get no tag: the M and C lines already name both
  // (Grant, 2026-11-19, struck it out on the design).
  if (!sides.customStrings && comboParts(colourIdOf(job.stringColor ?? null, customs))) out.push('twoColour');
  if (job.ownString) out.push('ownString');
  return out;
}

const TAG_EN: Record<StringTag, string> = { customTension: 'Custom tension', twoColour: 'Two-colour set', ownString: 'Your own string' };

/**
 * The racket card: the job's reference numbers across the top (the invoice
 * left, the job right), then the render beside the racket's spec, and the
 * cost ONCE at the bottom. Nothing else in the email repeats the cost.
 */
export function racketCard(opts: {
  job: CardJob;
  pictureUrl: string | null;
  /** Reference numbers, across the top of the card: `left` (an invoice) and
   *  `right` (the job). */
  refs: { left?: { label: string; value: string }; right?: { label: string; value: string } };
  facts: Array<{ label: string; value: string; mono?: boolean }>;
  cost: CardCost | null;
  customs?: readonly CustomColour[];
}): string {
  const { job, facts, cost } = opts;
  const customs = opts.customs ?? [];
  const sides = jobSides(job, customs);
  const tags = stringTags(job, customs).map((t) => tag(TAG_EN[t], t === 'customTension')).join('');

  const strings =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    sideRow('M', sides.mains.string, swatchHex(sides.mains.colour), sides.mains.tension, sides.customTension) +
    sideRow('C', sides.crosses.string, swatchHex(sides.crosses.colour), sides.crosses.tension, sides.customTension) +
    `</table>`;

  const factRows = facts
    .map(
      (f) =>
        `<div style="margin:0 0 10px">${label(f.label)}<div style="font-family:${f.mono ? MONO : SANS};font-size:${f.mono ? 14 : 15}px;font-weight:${f.mono ? 500 : 600};color:${C.ink}">${e(f.value)}</div></div>`,
    )
    .join('');

  const costBlock = cost
    ? `<div style="padding-top:10px">${label(cost.label)}` +
      `<div class="rc-cost" style="font-family:${DISPLAY};font-size:34px;line-height:1;font-weight:700;color:${cost.owed ? C.amber : C.ink}">${e(cost.value)}</div>` +
      (cost.note ? `<div style="margin-top:4px;font-family:${SANS};font-size:12px;color:${C.muted}">${e(cost.note)}</div>` : '') +
      `</div>`
    : '';

  const picture = opts.pictureUrl
    ? `<img src="${e(opts.pictureUrl)}" width="88" height="229" alt="${e(job.racketLabel)}" style="display:block;margin:0 auto;width:88px;height:229px;border:0">`
    : '';

  const info =
    `<div style="padding:18px 18px 16px">` +
    `<div style="margin:0 0 10px">${label('Racket')}<div style="font-family:${DISPLAY};font-size:19px;line-height:1.2;font-weight:700;color:${C.ink}">${e(job.racketLabel)}</div></div>` +
    `<div style="margin:0 0 10px">${label('Strings', tags)}${strings}</div>` +
    factRows +
    costBlock +
    `</div>`;

  const ref = (r: { label: string; value: string } | undefined, align: 'left' | 'right') =>
    `<td align="${align}" valign="top" style="padding:14px 18px 0;text-align:${align}">` +
    (r ? `${label(r.label)}<div style="font-family:${MONO};font-size:14px;font-weight:500;color:${C.ink}">${e(r.value)}</div>` : '') +
    `</td>`;
  const refRow = opts.refs.left || opts.refs.right
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:16px;line-height:1.4"><tr>${ref(opts.refs.left, 'left')}${ref(opts.refs.right, 'right')}</tr></table>`
    : '';

  if (!picture) {
    return `<div style="margin:0 0 18px;border-radius:16px;background:${C.tint}">${refRow}${info}</div>`;
  }

  /* "Fluid hybrid": two inline-block columns that sit side by side when the
     card is wide enough for both (PIC_W + INFO_MIN) and STACK, racket on top,
     when it is not. It needs no media query, which Gmail does not always
     apply (Grant, on a phone, twice: "squished"). Outlook desktop, which
     ignores max-width, gets the same two columns from a conditional table. */
  return (
    `<div style="margin:0 0 18px;border-radius:16px;background:${C.tint};font-size:0;line-height:0;text-align:center">` +
    refRow +
    `<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="${PIC_W}" valign="top"><![endif]-->` +
    `<div style="display:inline-block;vertical-align:top;width:100%;max-width:${PIC_W}px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" height="${PIC_H}" style="height:${PIC_H}px;border-radius:12px;background:${EMAIL_RACKET_GROUND}">${picture}</td></tr></table>` +
    `</td></tr></table>` +
    `</div>` +
    `<!--[if mso]></td><td valign="top"><![endif]-->` +
    `<div style="display:inline-block;vertical-align:top;width:100%;min-width:${INFO_MIN}px;max-width:${INFO_MAX}px;font-size:16px;line-height:1.4;text-align:left">${info}</div>` +
    `<!--[if mso]></td></tr></table><![endif]-->` +
    `</div>`
  );
}

/** The render's column, and the narrowest the spec column may get before the
 *  card stacks. 200 + 240 = 440: any card narrower than that stacks. */
const PIC_W = 200;
const PIC_H = 260;
const INFO_MIN = 240;
const INFO_MAX = 312;

// ── The whole message ────────────────────────────────────────────────────────

/**
 * A phone gets less padding round the frame and a smaller cost figure, where
 * the client applies a <style> block's media query (Gmail and Apple Mail
 * mostly do). Nothing depends on it: the racket card stacks by itself.
 */
const PHONE_STYLE =
  '<style>@media only screen and (max-width:480px){' +
  '.em-outer{padding:12px 6px !important}' +
  '.em-head{padding:16px !important}' +
  '.em-body{padding:24px 16px 10px !important}' +
  '.rc-cost{font-size:30px !important}' +
  '.rc-tn{padding-left:6px !important}' +
  '}</style>';

/**
 * The frame every email shares: the dark header with the app's mark and a
 * small tag naming what this is, the body blocks, and a footer that says why
 * the person got it.
 */
export function emailHtml(opts: { origin: string | null; tag: string; preheader: string; body: string; footer: string }): string {
  const mark = absolute(opts.origin, assetUrl('brand/email/bpm-mark.png'));
  const logo =
    (mark ? `<td width="52" valign="middle" style="padding-right:12px"><img src="${e(mark)}" width="52" height="40" alt="" style="display:block;width:52px;height:40px;border:0"></td>` : '') +
    `<td valign="middle"><div style="font-family:${DISPLAY};font-size:24px;line-height:1;font-weight:700;color:${C.headInk}">${e(APP_NAME)}</div>` +
    `<div style="margin-top:4px;font-family:${DISPLAY};font-size:10px;line-height:1;font-weight:700;letter-spacing:.2em;color:${C.logo}">MOTIONCRAFT STUDIO</div></td>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">${PHONE_STYLE}</head>` +
    `<body style="margin:0;padding:0;background:${C.page}">` +
    // The line a mail app shows under the subject in the inbox list.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(opts.preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}"><tr><td class="em-outer" align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border-radius:20px;overflow:hidden;background:${C.card};border-collapse:separate">` +
    `<tr><td class="em-head" style="background:${C.head};padding:20px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${logo}</tr></table></td>` +
    `<td align="right" valign="middle" style="font-family:${MONO};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${C.logo}">${e(opts.tag)}</td>` +
    `</tr></table></td></tr>` +
    `<tr><td class="em-body" style="padding:30px 24px 14px">${opts.body}</td></tr>` +
    `<tr><td style="background:${C.tint};padding:18px 24px 22px;font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted}">` +
    `<strong style="color:${C.ink}">${e(APP_NAME)}</strong> · Motioncraft Studio<br>${e(opts.footer)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
