/**
 * Turning a spoken score call into a rally (docs/plans/voice-score.md).
 *
 * Pure, no I/O: the recogniser (`lib/useVoiceScore.ts`) hands this a
 * transcript, and the board decides what the call means against the score it
 * already holds.
 *
 * THE RULE: a call is accepted only when it is exactly ONE RALLY ON from the
 * board. The rally winner serves next and the umpire calls the server's score
 * first, so "eleven seven" after 10–7 means the side now on 11 won the rally.
 * Anything else, a neighbouring court's call above all, is reported as heard
 * and never scored. The order is forgiven ("seven eleven" reads the same),
 * which costs nothing: two outcomes can only fit one call at a level score,
 * whichever way round it is said.
 *
 * At a level score ("six five" at 5 all) either side could have won, so the
 * board ASKS rather than guesses, unless the call said "service over" and the
 * board knows who was serving. "X all" never needs asking: the side that was
 * one behind won.
 */

import { CAP, scoreState, type Score, type Side } from './scoreRules';

export interface ParsedCall {
  /** Every reading of the numbers heard, most likely first. "twenty one" is 21, or 20 and 1. */
  readings: Reading[];
  /** "Service over" was said: the side that was NOT serving won the rally. */
  serviceOver: boolean;
}

export type Reading = { kind: 'pair'; first: number; second: number } | { kind: 'all'; n: number };

/** A score as it was SPOKEN: first number first ("11 7" is `[11, 7]`). */
export type Heard = readonly [number, number];

export type CallMatch =
  /** One rally on: score it. */
  | { kind: 'point'; side: Side; heard: Heard }
  /** One rally on, but either side fits (a level score): ask which. */
  | { kind: 'ask'; heard: Heard }
  /** The board's own score again (a repeated call): nothing to do. */
  | { kind: 'same' }
  /** A score, but not one rally on from the board: show it, score nothing. */
  | { kind: 'ignored'; heard: Heard }
  /** No score in what was said. */
  | { kind: 'none' }
  /** The game is finished: nothing scores. */
  | { kind: 'over' };

const UNITS: Record<string, number> = {
  love: 0, zero: 0, nil: 0, oh: 0,
  one: 1, won: 1,
  two: 2, too: 2,
  three: 3,
  four: 4, for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8, ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30 };

type Token =
  | { n: number; tens: boolean }
  | { word: 'all' }
  | { word: 'to' }
  /** A digit run with the space lost ("117"): every way to split it into two scores. */
  | { splits: Array<[number, number]> };

function splitsOf(run: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 1; i < run.length; i++) {
    const a = run.slice(0, i);
    const b = run.slice(i);
    // "07" is not how a recogniser writes seven; a leading zero is not a split.
    if ((a.length > 1 && a[0] === '0') || (b.length > 1 && b[0] === '0')) continue;
    if (a.length <= 2 && b.length <= 2 && Number(a) <= CAP && Number(b) <= CAP) out.push([Number(a), Number(b)]);
  }
  return out;
}

function tokens(text: string): { list: Token[]; serviceOver: boolean } {
  const lower = text.toLowerCase();
  const serviceOver = /\b(service|serve|serves)\s+(over|change)\b/.test(lower);
  // A digit run like "11-7" or "11:7" splits into its numbers; a hyphen joins
  // words too ("twenty-one"), and splitting it reads the same.
  const words = lower.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const list: Token[] = [];
  for (const w of words) {
    if (/^\d{1,2}$/.test(w)) list.push({ n: Number(w), tens: Number(w) === 20 || Number(w) === 30 });
    else if (/^\d{3,4}$/.test(w)) {
      const splits = splitsOf(w);
      if (splits.length > 0) list.push({ splits });
    }
    else if (w in TENS) list.push({ n: TENS[w], tens: true });
    else if (w === 'all' || w === 'apiece') list.push({ word: 'all' });
    else if (w === 'to') list.push({ word: 'to' });
    else if (w in UNITS) list.push({ n: UNITS[w], tens: false });
    // Anything else ("nice", "shot", "service", "over") is not part of a score.
  }
  return { list, serviceOver };
}

/**
 * The number sequences a token run can mean. "to" between two numbers is a
 * separator ("eleven to seven"), elsewhere the number 2; a tens word followed
 * by a unit is either one number or two ("twenty one" is 21, or 20 then 1).
 */
function sequences(list: Token[]): Array<Array<number | 'all'>> {
  let out: Array<Array<number | 'all'>> = [[]];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if ('splits' in t) {
      out = t.splits.flatMap(([a, b]) => out.map((s) => [...s, a, b]));
      continue;
    }
    if ('word' in t) {
      if (t.word === 'all') {
        out = out.map((s) => [...s, 'all']);
        continue;
      }
      const prev = list[i - 1];
      const next = list[i + 1];
      const between = prev && next && 'n' in prev && 'n' in next;
      if (!between) out = out.map((s) => [...s, 2]);
      continue;
    }
    const next = list[i + 1];
    if (t.tens && next && 'n' in next && !next.tens && next.n >= 1 && next.n <= 9) {
      const joined = out.map((s) => [...s, t.n + next.n]);
      const apart = out.map((s) => [...s, t.n, next.n]);
      out = [...joined, ...apart];
      i++;
      continue;
    }
    out = out.map((s) => [...s, t.n]);
  }
  return out;
}

function readingOf(seq: Array<number | 'all'>): Reading | null {
  // The call is at the END of what was said ("nice one, eleven seven").
  const last = seq[seq.length - 1];
  if (last === 'all') {
    const n = seq[seq.length - 2];
    return typeof n === 'number' && n <= CAP ? { kind: 'all', n } : null;
  }
  const nums = seq.filter((x): x is number => typeof x === 'number');
  if (nums.length < 2) return null;
  const first = nums[nums.length - 2];
  const second = nums[nums.length - 1];
  if (first > CAP || second > CAP) return null;
  return { kind: 'pair', first, second };
}

export function parseCall(text: string): ParsedCall {
  const { list, serviceOver } = tokens(text);
  const readings: Reading[] = [];
  const seen = new Set<string>();
  for (const seq of sequences(list)) {
    const r = readingOf(seq);
    if (!r) continue;
    const key = r.kind === 'all' ? `all:${r.n}` : `${r.first}-${r.second}`;
    if (seen.has(key)) continue;
    seen.add(key);
    readings.push(r);
  }
  return { readings, serviceOver };
}

function spoken(r: Reading): Heard {
  return r.kind === 'all' ? [r.n, r.n] : [r.first, r.second];
}

/** Which sides' wins this reading describes, in either order. */
function winnersOf(score: Score, r: Reading): Side[] {
  const [x, y] = spoken(r);
  const fits = (a: number, b: number) => (x === a && y === b) || (x === b && y === a);
  const out: Side[] = [];
  if (fits(score.a + 1, score.b)) out.push('a');
  if (fits(score.a, score.b + 1)) out.push('b');
  return out;
}

/**
 * What a call means for the board. `server` is who served the rally just
 * played (the board's `serving(points)`), null before the first point.
 *
 * Tries every reading of every transcript, best first, and takes the first
 * that is one rally on. Both sides fit only at a level score, and then the
 * board asks, unless "service over" was said and it knows who was serving.
 * A reading that repeats the board's own score is "same"; anything else
 * reports the first score heard and scores nothing.
 */
export function matchCall(score: Score, server: Side | null, calls: readonly ParsedCall[]): CallMatch {
  if (scoreState(score).over) return { kind: 'over' };
  let firstHeard: Heard | null = null;
  let repeated = false;

  for (const call of calls) {
    for (const reading of call.readings) {
      const heard = spoken(reading);
      const winners = winnersOf(score, reading);
      if (winners.length === 1) return { kind: 'point', side: winners[0], heard };
      if (winners.length === 2) {
        if (call.serviceOver && server) return { kind: 'point', side: server === 'a' ? 'b' : 'a', heard };
        return { kind: 'ask', heard };
      }
      const [x, y] = heard;
      if ((x === score.a && y === score.b) || (x === score.b && y === score.a)) repeated = true;
      if (!firstHeard) firstHeard = heard;
    }
  }
  if (repeated) return { kind: 'same' };
  if (firstHeard) return { kind: 'ignored', heard: firstHeard };
  return { kind: 'none' };
}

/** The score as it was spoken: "11–7". */
export function heardText(heard: Heard): string {
  return `${heard[0]}–${heard[1]}`;
}
