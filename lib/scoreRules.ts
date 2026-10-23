/**
 * Keeping score in a game of badminton — the rules the score widget applies
 * (docs/plans/native-widgets.md, "Keeping score from the widget").
 *
 * THIS FILE IS THE SPEC. The widget runs on the phone, so the same rules are
 * ported to Swift (`ios/App/BPMWidget/BPMScoreWidget.swift`) and Java
 * (`android/.../ScoreRules.java`); `__tests__/score-rules.test.ts` holds the
 * cases, and a port is right when it agrees with every one of them. Pure, no
 * I/O, no clock.
 *
 * The words are the umpire's, not tennis's (Grant, 2026-10-23): a game is to
 * 21, won by two, capped at 30; "game point" for the side one rally from
 * winning; "20 all", never "deuce" or "advantage"; "29 all" means the next
 * point wins. There is an INTERVAL when the leading side first reaches 11;
 * ends change after each game, and at 11 only in a deciding third game.
 */

export const GAME_TO = 21;
export const WIN_BY = 2;
export const CAP = 30;
export const INTERVAL_AT = 11;

export type Side = 'a' | 'b';

export interface Score {
  a: number;
  b: number;
}

export interface ScoreState extends Score {
  /** The game is finished: nobody scores from here. */
  over: boolean;
  winner: Side | null;
  /** The side one rally from winning, while the game is live. */
  gamePoint: Side | null;
  /** Level at 20 or above ("20 all", "24 all"); null otherwise. */
  allAt: number | null;
  /** 29 all: whoever takes the next rally takes the game. */
  nextPointWins: boolean;
}

function winsAt(score: number, other: number): boolean {
  return score >= CAP || (score >= GAME_TO && score - other >= WIN_BY);
}

/** Would `side` win the game with one more point from here? */
export function wouldWin(score: Score, side: Side): boolean {
  if (scoreState(score).over) return false;
  return side === 'a' ? winsAt(score.a + 1, score.b) : winsAt(score.b + 1, score.a);
}

export function scoreState(score: Score): ScoreState {
  const { a, b } = score;
  const winner: Side | null = winsAt(a, b) ? 'a' : winsAt(b, a) ? 'b' : null;
  const over = winner !== null;
  const gamePoint: Side | null = over
    ? null
    : winsAt(a + 1, b)
      ? 'a'
      : winsAt(b + 1, a)
        ? 'b'
        : null;
  const level = !over && a === b && a >= GAME_TO - 1;
  return {
    a,
    b,
    over,
    winner,
    gamePoint,
    allAt: level ? a : null,
    nextPointWins: level && a === CAP - 1,
  };
}

/** A point for `side`, or the same score when the game is already over. */
export function addPoint(score: Score, side: Side): Score {
  if (scoreState(score).over) return score;
  return side === 'a' ? { a: score.a + 1, b: score.b } : { a: score.a, b: score.b + 1 };
}

/**
 * Did the last point bring on the interval — the leading side reaching 11 for
 * the first time? Decided from the point before and after, because the score
 * alone cannot tell "just reached 11" from "play resumed at 11–10".
 */
export function reachedInterval(prev: Score, next: Score): boolean {
  return Math.max(prev.a, prev.b) < INTERVAL_AT && Math.max(next.a, next.b) === INTERVAL_AT;
}

/** Who serves: whoever won the last rally. Nobody before the first point. */
export function serving(points: readonly Side[]): Side | null {
  return points.length > 0 ? points[points.length - 1] : null;
}

/** `"21-18"` — the score as it travels in `bpm://open?tab=skills&game=`. */
export function gameParam(score: Score): string {
  return `${score.a}-${score.b}`;
}

/**
 * The `game` parameter back into a score, or null for anything that is not
 * two whole numbers between 0 and the cap. A link can carry anything; the
 * sheet it opens must not.
 */
export function parseGameParam(raw: string | null | undefined): Score | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > CAP || b > CAP) return null;
  return { a, b };
}
