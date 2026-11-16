import type { ReelColourId } from './stringPalette';
import type { Fullness } from './stringStocktakeMath';

/**
 * THE STOCKTAKE'S TALLY — client-safe, no I/O (docs/plans/string-barcode-stocktake.md).
 *
 * A row is one shelf string in one colour (`null` = mixed / not sure), and
 * holds what was counted: packets, and each reel by eye or by weight. A scan
 * adds to the row its barcode was taught as; the hand count edits the same
 * rows. Saving sends one line per row, which is exactly the shape
 * `validateCount` re-adds on the server.
 */

export type Reel = { by: 'eye'; fullness: Fullness } | { by: 'weigh'; grams: string; tare: string; gpm: string };
export interface TallyRow { label: string; color: ReelColourId | null; packets: number; reels: Reel[] }
export type Tally = Record<string, TallyRow>;

/** What a taught barcode stands for. */
export interface ScanAnswer { code: string; label: string; color: ReelColourId | null; form: 'packet' | 'reel' }

/** One key per string and colour. The separator cannot appear in a label or a colour id. */
export const rowKey = (label: string, color: ReelColourId | null) => `${label}\u0000${color ?? ''}`;

const blank = (label: string, color: ReelColourId | null): TallyRow => ({ label, color, packets: 0, reels: [] });

/** The tally with one row changed (made, when it is new). Never mutates. */
export function updateRow(tally: Tally, label: string, color: ReelColourId | null, fn: (row: TallyRow) => TallyRow): Tally {
  const key = rowKey(label, color);
  return { ...tally, [key]: fn(tally[key] ?? blank(label, color)) };
}

/** A scanned packet: one more of its string and colour. */
export function addPacket(tally: Tally, answer: Pick<ScanAnswer, 'label' | 'color'>): Tally {
  return updateRow(tally, answer.label, answer.color, (r) => ({ ...r, packets: r.packets + 1 }));
}

/** A scanned reel, once the counter has said how full it is (or chosen to weigh it). */
export function addReel(tally: Tally, answer: Pick<ScanAnswer, 'label' | 'color'>, reel: Reel): Tally {
  return updateRow(tally, answer.label, answer.color, (r) => ({ ...r, reels: [...r.reels, reel] }));
}

/** Every row of one string, mixed first, then by colour id. */
export function rowsOf(tally: Tally, label: string): TallyRow[] {
  return Object.values(tally)
    .filter((r) => r.label === label)
    .sort((a, b) => (a.color === b.color ? 0 : a.color === null ? -1 : b.color === null ? 1 : a.color < b.color ? -1 : 1));
}

/** The tally without any row of this string: "leave it out". */
export function withoutString(tally: Tally, label: string): Tally {
  return Object.fromEntries(Object.entries(tally).filter(([, r]) => r.label !== label));
}

const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** A weigh-in still missing a figure: Save waits for it, rather than sending a guess. */
export const weighIncomplete = (tally: Tally) =>
  Object.values(tally).some((row) => row.reels.some((r) => r.by === 'weigh' && !(toNum(r.grams) >= 0 && toNum(r.tare) >= 0 && toNum(r.gpm) > 0)));

/** The body's lines: one per row, the server re-adds every one. */
export function linesForSave(tally: Tally) {
  return Object.values(tally).map((row) => ({
    label: row.label,
    ...(row.color ? { color: row.color } : {}),
    packets: row.packets,
    reels: row.reels.map((r) => (r.by === 'eye'
      ? { by: 'eye' as const, fullness: r.fullness }
      : { by: 'weigh' as const, grams: toNum(r.grams), tareGrams: toNum(r.tare), gramsPerMetre: toNum(r.gpm) })),
  }));
}

/**
 * The camera reads the same barcode many times a second while it stays in
 * view. A code counts again only after it has been away for `gapMs`, or a
 * different code was read in between — so a stack of identical packets is
 * counted one at a time as each is shown, never ten times for one.
 */
export const SCAN_GAP_MS = 1500;
export function makeScanGate(gapMs = SCAN_GAP_MS) {
  let last: { code: string; at: number } | null = null;
  return function accept(code: string, now: number): boolean {
    const repeat = last !== null && last.code === code && now - last.at < gapMs;
    last = { code, at: now };
    return !repeat;
  };
}
