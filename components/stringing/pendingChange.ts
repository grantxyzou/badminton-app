import { fmtMoney } from '@/lib/fmt';
import { playerTensionText } from '@/lib/stringing';
import type { PlayerPendingEdit } from '@/lib/types';

/** One line of "What changes": the field, what it was, what it would be. */
export interface ChangeRow {
  key: 'racket' | 'string' | 'tension' | 'price';
  from: string;
  to: string;
}

/** "27/29" (the projection's tension shape) as the player reads it: "27 lb",
 *  or "27/29 lb" for a pair that is not the conventional one. */
function tensionText(raw: string | undefined, lb: string): string {
  if (!raw) return '';
  const [m, c] = raw.split('/').map(Number);
  const text = Number.isFinite(m) && Number.isFinite(c) ? playerTensionText(m, c) : raw;
  return `${text} ${lb}`;
}

/**
 * The diff a player is asked about, in the order they read it: what goes on
 * the racket, then what it costs. Only fields that change are present on the
 * projection, so only those make a row. Money is exact (`fmtMoney`); an
 * unpriced side reads as `unpriced`, never as $0.
 */
export function changeRows(
  edit: PlayerPendingEdit,
  words: { lb: string; unpriced: string },
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  if (edit.racketTo !== undefined) rows.push({ key: 'racket', from: edit.racketFrom ?? '', to: edit.racketTo });
  if (edit.stringTo !== undefined) rows.push({ key: 'string', from: edit.stringFrom ?? '', to: edit.stringTo });
  if (edit.tensionTo !== undefined) {
    rows.push({ key: 'tension', from: tensionText(edit.tensionFrom, words.lb), to: tensionText(edit.tensionTo, words.lb) });
  }
  if (edit.priceTo !== undefined) {
    const money = (v: number | null | undefined) => (typeof v === 'number' ? fmtMoney(v) : words.unpriced);
    rows.push({ key: 'price', from: money(edit.priceFrom), to: money(edit.priceTo) });
  }
  return rows;
}

