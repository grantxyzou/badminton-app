import type { GameResult } from './types';

/**
 * Turn raw game docs into one player's record.
 *
 * Games store player NAMES, never memberIds — `lib/levelStore.ts` documents
 * why that must not be "fixed" without migrating the container first. So every
 * join here is name-based and case-insensitive, matching the rest of the app.
 */

export interface PlayedGame {
  id: string;
  /** The viewer's team's score. */
  mine: number;
  /** The opposing team's score. */
  theirs: number;
  won: boolean;
  /** The viewer's team-mates, excluding the viewer. Usually exactly one. */
  partners: string[];
  loggedAt: string;
}

export interface GameRecord {
  played: number;
  won: number;
  /** Newest first. */
  rows: PlayedGame[];
}

const norm = (n: unknown) => String(n ?? '').trim().toLowerCase();

/**
 * A draw is impossible in badminton — a game is played to a winning margin —
 * but nothing validates that on the way in, so a mis-typed 21-21 would
 * otherwise silently count as a loss. Treating "not a win" as a loss is the
 * honest reading: we only ever claim a win when the viewer's score is higher.
 */
export function summarizeRecord(games: GameResult[], name: string): GameRecord {
  const me = norm(name);
  const rows: PlayedGame[] = [];

  for (const g of games) {
    if (!g) continue;
    const teamA = (g.teamA ?? []).map(String);
    const teamB = (g.teamB ?? []).map(String);
    const onA = teamA.some((n) => norm(n) === me);
    const onB = teamB.some((n) => norm(n) === me);
    // Not in this game, or somehow in both — either way there is no coherent
    // "my score", so skip rather than guess.
    if (onA === onB) continue;

    const mine = onA ? g.scoreA : g.scoreB;
    const theirs = onA ? g.scoreB : g.scoreA;
    if (typeof mine !== 'number' || typeof theirs !== 'number') continue;

    rows.push({
      id: g.id,
      mine,
      theirs,
      won: mine > theirs,
      partners: (onA ? teamA : teamB).filter((n) => norm(n) !== me),
      loggedAt: g.loggedAt,
    });
  }

  rows.sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)));

  return {
    played: rows.length,
    won: rows.filter((r) => r.won).length,
    rows,
  };
}
