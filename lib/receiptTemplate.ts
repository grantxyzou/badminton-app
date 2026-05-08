/**
 * Pure receipt-template helpers. No DOM, no fetch — easy to unit-test.
 *
 * Receipt is rendered both as plain text (clipboard-friendly) and as a 390×520
 * canvas image (shareable to WeChat/iMessage). The text format is the source
 * of truth; the image renders the same content with design-system fonts.
 */

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
  /** E-transfer recipient. */
  recipient: { name: string; email: string };
  /** Memo template. `{date}` and `{name}` are interpolated. */
  memoTemplate?: string;
  /** Optional admin note. */
  note?: string;
}

export interface IndividualReceiptInput extends ReceiptInput {
  /** Player the receipt is addressed to (used in memo + greeting). */
  playerName: string;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function fmtMemo(template: string, dateIso: string, name: string): string {
  const dateShort = (() => {
    if (!dateIso) return '';
    try {
      return new Date(dateIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateIso.slice(0, 10);
    }
  })();
  return template
    .replace(/\{date\}/g, dateShort)
    .replace(/\{name\}/g, name);
}

const DEFAULT_MEMO = 'BPM {date} - {name}';

/** Group-format text: posted to the friend-group chat once the bill is sent.
 *  Lead with the headline ("$X each"), keep the bookkeeping in a parenthetical
 *  at the bottom. People stop reading after the dollar amount; everything
 *  load-bearing should be before that line. */
export function renderGroupText(input: ReceiptInput): string {
  const { datetime, costPerPerson, courts, totalCost, playerNames, recipient, memoTemplate, note } = input;
  const memo = fmtMemo(memoTemplate ?? DEFAULT_MEMO, datetime, '{your name}');
  const courtLabel = `${courts} court${courts === 1 ? '' : 's'}`;
  const playerLabel = `${playerNames.length} of us`;
  const lines = [
    `Badminton on ${fmtDate(datetime)} was $${costPerPerson} each.`,
    '',
    `E-transfer me at ${recipient.email}`,
    `Memo: ${memo}`,
    '',
    `(${courtLabel} · ${playerLabel} · $${totalCost} total)`,
  ];
  if (note?.trim()) {
    lines.push('', note.trim());
  }
  return lines.join('\n');
}

/** Individual-format text: friendly nudge for a single player. */
export function renderIndividualText(input: IndividualReceiptInput): string {
  const { datetime, costPerPerson, recipient, memoTemplate, playerName, note } = input;
  const memo = fmtMemo(memoTemplate ?? DEFAULT_MEMO, datetime, playerName);
  const lines = [
    `Hey ${playerName} — badminton on ${fmtDate(datetime)} was $${costPerPerson}.`,
    '',
    `E-transfer me at ${recipient.email}`,
    `Memo: ${memo}`,
  ];
  if (note?.trim()) {
    lines.push('', note.trim());
  }
  lines.push('', 'Thanks!');
  return lines.join('\n');
}

/**
 * Draw the group receipt to a 390×520 canvas. Returns a data URL.
 * Caller should `await document.fonts.ready` before invoking.
 */
export function renderGroupCanvas(input: ReceiptInput, canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const W = 390;
  const H = 520;
  canvas.width = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

  // Background
  ctx.fillStyle = '#0c0c14';
  ctx.fillRect(0, 0, W, H);

  // Wordmark — small label, sets context
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(`Badminton · ${fmtDate(input.datetime)}`, 24, 36);

  // Lead line — "was $X each"
  ctx.fillStyle = '#f3f4f6';
  ctx.font = '600 18px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('today was', 24, 70);

  // Amount (display font, prominent)
  ctx.fillStyle = '#86efac';
  ctx.font = '700 56px "Space Grotesk", system-ui, sans-serif';
  ctx.fillText(`$${input.costPerPerson}`, 24, 130);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '400 14px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('each', 24, 152);

  // Totals line — admin transparency, smaller
  ctx.fillStyle = '#d1d5db';
  ctx.font = '400 13px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText(
    `${input.courts} court${input.courts === 1 ? '' : 's'} · ${input.playerNames.length} of us · $${input.totalCost} total`,
    24, 184,
  );

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.moveTo(24, 208);
  ctx.lineTo(W - 24, 208);
  ctx.stroke();

  // E-transfer block
  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('E-TRANSFER ME AT', 24, 230);
  ctx.fillStyle = '#f3f4f6';
  ctx.font = '500 14px "JetBrains Mono", monospace';
  ctx.fillText(input.recipient.email, 24, 252);

  ctx.fillStyle = '#9ca3af';
  ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('MEMO', 24, 286);
  ctx.fillStyle = '#f3f4f6';
  ctx.font = '500 14px "JetBrains Mono", monospace';
  ctx.fillText(fmtMemo(input.memoTemplate ?? DEFAULT_MEMO, input.datetime, '{your name}'), 24, 308);

  // Players list (truncated to fit)
  if (input.playerNames.length > 0) {
    ctx.fillStyle = '#9ca3af';
    ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
    ctx.fillText('WHO PLAYED', 24, 350);
    ctx.fillStyle = '#d1d5db';
    ctx.font = '400 13px "IBM Plex Sans", system-ui, sans-serif';
    const players = wrapLine(ctx, input.playerNames.join(', '), W - 48);
    let y = 372;
    for (const line of players.slice(0, 5)) {
      ctx.fillText(line, 24, y);
      y += 18;
    }
  }

  // Footer
  ctx.fillStyle = '#6b7280';
  ctx.font = '400 11px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText('Thanks for playing 🏸', 24, H - 24);

  return canvas.toDataURL('image/png');
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
