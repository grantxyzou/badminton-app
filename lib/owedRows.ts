/**
 * The PLAYER-FIRST read behind "what does this person owe?"
 *
 * `/api/players/unpaid` runs on every Home mount for every signed-in member,
 * and `/api/admin/owed-audit` is its admin twin. Both used to read EVERY
 * session in the group and then EVERY player row of every relevant session,
 * and filter to one person in JS — a whole-history read of two containers
 * (~1 MB, 150–250 RU at a hundred archived sessions) to answer a question
 * whose result is a handful of rows, on first paint. The join is flipped
 * here: the person's own rows first (a small, indexed result), then only
 * the sessions those rows name, then the roster of only the UNSETTLED ones
 * among them — the one place a live per-person denominator is still needed,
 * because a settled session has its amount frozen on the row.
 *
 * Every query keeps its JS re-check: the mock store filters by parameter
 * NAME and ignores the ones it does not know (`@names`, `@sessionIds`), so
 * it returns every row where Cosmos returns the matching ones. The re-check
 * is what makes both answer the same thing (the same contract as the
 * `IN (...)` reads in sessions/recent).
 *
 * Two queries for the rows, never one with `OR` across two parameters: the
 * mock ANDs its per-parameter filters while Cosmos would OR them.
 */
import type { GroupScope } from './groupScope';
import { matchesIdentity, type ResolvedIdentity } from './playerIdentity';
import type { Player, Session } from './types';

export interface OwedInputs {
  /** This identity's player rows, across every session the group has. */
  players: Player[];
  /** The sessions those rows name (only the ones that exist). */
  sessionById: Map<string, Session>;
  /** Active roster size per UNSETTLED session the identity has a row in. */
  activeCountBySession: Map<string, number>;
}

export async function loadOwedInputs(
  scope: GroupScope,
  identity: Pick<ResolvedIdentity, 'memberId' | 'names'>,
  opts: { includeLegacy?: boolean } = {},
): Promise<OwedInputs> {
  const byId = new Map<string, Player>();
  const keep = (rows: Player[]) => {
    for (const p of rows) if (p && typeof p.id === 'string' && matchesIdentity(p, identity)) byId.set(p.id, p);
  };

  if (identity.memberId) {
    keep(
      await scope.query<Player>('players', {
        where: 'c.memberId = @memberId',
        params: [{ name: '@memberId', value: identity.memberId }],
      }),
    );
  }
  // Legacy rows carry a name and no memberId; alias-linked names are a
  // different name on the same person. `names` is already lowercased.
  const names = [...identity.names];
  if (names.length > 0) {
    keep(
      await scope.query<Player>('players', {
        where: 'ARRAY_CONTAINS(@names, LOWER(c.name))',
        params: [{ name: '@names', value: names }],
      }),
    );
  }
  const players = [...byId.values()];

  const sessionIds = [...new Set(players.map((p) => p.sessionId).filter((s): s is string => typeof s === 'string'))];
  const sessionById = new Map<string, Session>();
  if (sessionIds.length > 0) {
    const wanted = new Set(sessionIds);
    const sessions = await scope.query<Session>('sessions', {
      where: 'ARRAY_CONTAINS(@sessionIds, c.id)',
      params: [{ name: '@sessionIds', value: sessionIds }],
      includeLegacy: opts.includeLegacy,
    });
    for (const s of sessions) if (s && wanted.has(s.id)) sessionById.set(s.id, s);
  }

  const activeCountBySession = new Map<string, number>();
  const unsettledIds = [...sessionById.values()].filter((s) => !s.settled).map((s) => s.id);
  if (unsettledIds.length > 0) {
    const wanted = new Set(unsettledIds);
    const rows = await scope.query<Pick<Player, 'sessionId' | 'removed' | 'waitlisted'>>('players', {
      select: 'c.sessionId, c.removed, c.waitlisted',
      where: 'ARRAY_CONTAINS(@sessionIds, c.sessionId)',
      params: [{ name: '@sessionIds', value: unsettledIds }],
    });
    for (const p of rows) {
      if (typeof p.sessionId !== 'string' || !wanted.has(p.sessionId)) continue;
      if (p.removed === true || p.waitlisted === true) continue;
      activeCountBySession.set(p.sessionId, (activeCountBySession.get(p.sessionId) ?? 0) + 1);
    }
  }

  return { players, sessionById, activeCountBySession };
}
