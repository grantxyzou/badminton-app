import { activeRacket } from './activeRacket';
import type { GearItem, PlayerGear, StringLogEntry } from './types';

/**
 * The restring log: one entry each time a string goes on a racket, or the
 * tension it was strung at is recorded or changed. Nothing kept this history
 * before 2026-09-14 — a string's `tensionLbs` was overwritten in place — so
 * every "4 restrings", "your last four" and "since March" reads from here, and
 * a member who has not logged anything since simply has no line.
 *
 * Written only by the gear route, server-side, from the doc it just read.
 */

export const STRING_LOG_CAP = 50;

function append(log: StringLogEntry[] | undefined, entry: StringLogEntry): StringLogEntry[] {
  return [...(log ?? []), entry].slice(-STRING_LOG_CAP);
}

/** The racket a string is going on: the one in play, as the doc stands. */
function racketFields(gear: PlayerGear | null): Pick<StringLogEntry, 'racketItemId' | 'racketCatalogId'> {
  const racket = activeRacket(gear);
  return racket ? { racketItemId: racket.id, racketCatalogId: racket.catalogId } : {};
}

/** A string was added to the bag. Its tension, if any, arrives in a later PUT. */
export function logStringAdded(prior: PlayerGear | null, string: GearItem, at: string): StringLogEntry[] {
  return append(prior?.stringLog, {
    at,
    catalogId: string.catalogId,
    stringItemId: string.id,
    stringLabel: string.label,
    ...(typeof string.tensionLbs === 'number' ? { tensionLbs: string.tensionLbs } : null),
    ...racketFields(prior),
  });
}

/**
 * A string's tension was set. The same value again is not an event. The
 * first tension for a string that was just logged fills that entry rather than
 * counting a second restring; any later change is a new entry, because
 * re-stringing at a different tension is what a change means.
 */
export function logTension(
  prior: PlayerGear | null,
  string: GearItem,
  previousLbs: number | undefined,
  tensionLbs: number,
  at: string,
): StringLogEntry[] | undefined {
  if (previousLbs === tensionLbs) return undefined;
  const log = prior?.stringLog ?? [];
  const last = log[log.length - 1];
  if (last && last.stringItemId === string.id && last.tensionLbs === undefined) {
    return [...log.slice(0, -1), { ...last, tensionLbs }];
  }
  return append(log, {
    at,
    catalogId: string.catalogId,
    stringItemId: string.id,
    stringLabel: string.label,
    tensionLbs,
    ...racketFields(prior),
  });
}
