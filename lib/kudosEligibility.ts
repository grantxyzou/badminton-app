/**
 * WHO YOU MAY GIVE KUDOS TO.
 *
 * One owner, shared by `POST /api/kudos` (which enforces it) and
 * `GET /api/kudos/eligible` (which lists it). Two copies of this rule would
 * drift into a list offering names the POST then refuses — a dead button.
 *
 * THE RULE CHANGED 2026-08-29, from real user feedback. It used to be "both on
 * the ACTIVE session's roster", which made kudos unreachable in practice: the
 * owner advances the session minutes after play, so by the time anyone opened
 * the app the people they had just played with were no longer on the active
 * roster. Reported as "kudos goes away with the session too fast" — it was
 * actually immediately.
 *
 * Now: anyone who shared a roster with you in a RECENT session — of one group.
 * Every read here goes through `groupScope`, so a co-player is always someone
 * from the same club.
 */
import { ensureContainer } from '@/lib/cosmos';
import { groupScope, sessionPrefix } from '@/lib/groupScope';

/**
 * How far back co-play counts. Two months of Thursdays.
 *
 * NOT "ever": `players` is partitioned by `/sessionId`, so an unbounded search
 * is a cross-partition scan of every session the club has held — the shape
 * CLAUDE.md flags for the `club/bands` query. Eight keeps anyone you would
 * plausibly recognise reachable while the cost stays bounded: one bounded
 * `sessions` read, then at most nine `players` reads (the active session and
 * eight dated ones) issued CONCURRENTLY — one round trip, not nine — plus, on
 * the enforcement path only, nine `gameResults` reads, again concurrent, and
 * only when no roster already proved it.
 */
export const CO_PLAY_LOOKBACK_SESSIONS = 8;

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Session ids co-play may be proven against: the ACTIVE one first, then recent
 * dated ones, newest first.
 *
 * The active id leads because it is the only way the LEGACY `'current-session'`
 * id is reachable. That id is still live in production (CLAUDE.md) and does
 * not match the dated prefix, so a prefix filter alone would silently exclude
 * the very session most people just played. The order is also the order
 * `eligibleCoPlayers` lists people in: the ones you played with most recently
 * come first.
 */
async function recentSessionIds(
  groupId: string,
  activeSessionId: string,
  limit = CO_PLAY_LOOKBACK_SESSIONS,
): Promise<string[]> {
  const ids: string[] = activeSessionId ? [activeSessionId] : [];
  const prefix = sessionPrefix(groupId);
  try {
    // Bounded IN THE QUERY, not only in JS. `sessions` is partitioned by
    // /sessionId, so an unbounded SELECT is a cross-partition scan of every
    // session the club has ever held, on every card mount and every send.
    // The JS sort/slice below stays as the real filter because the mock
    // store ignores ORDER BY; the LIMIT is what stops real Cosmos reading the
    // whole container. +1 covers the active id being in range. Within one
    // group every dated id shares a prefix, so lexical order IS date order.
    const resources = await groupScope(groupId).query<{ id?: string }>('sessions', {
      select: 'c.id',
      orderBy: 'c.id DESC',
      limit: limit + 1,
    });
    const dated = resources
      .map((r) => r?.id)
      .filter((id): id is string => typeof id === 'string' && id.startsWith(prefix) && id !== activeSessionId)
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);
    ids.push(...dated);
  } catch {
    /* The active session alone is a correct, if narrower, answer. */
  }
  return ids;
}

/**
 * Non-removed roster names for one session, as stored (display case).
 * A failed read answers an EMPTY roster so one session's outage narrows the
 * answer rather than failing it — the same skip the loop used to make.
 */
async function rosterNames(groupId: string, sessionId: string): Promise<string[]> {
  try {
    // `@sessionId`, not `@sid`: the mock filters by parameter NAME, and `@sid`
    // was one it did not know — so this returned every row in tests.
    const resources = await groupScope(groupId).query<{ name?: string; removed?: boolean; sessionId?: string; guestOf?: string }>('players', {
      select: 'c.name, c.removed, c.sessionId, c.guestOf',
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: sessionId }],
      partitionKey: sessionId,
    });
    // The JS re-filter stays for parity with real Cosmos either way.
    return resources
      // A plus-one has no account to receive kudos (docs/plans/plus-one.md).
      .filter((p) => p && p.sessionId === sessionId && p.removed !== true && !p.guestOf && typeof p.name === 'string')
      .map((p) => p.name as string);
  } catch {
    return [];
  }
}

/**
 * The rosters of several sessions, in the order asked for.
 *
 * Read CONCURRENTLY, one query per session: `players` is partitioned by
 * `/sessionId`, so each is a single-partition read, and nine of them in flight
 * together cost one round trip where the old loop paid nine in series on every
 * card mount and every send. Still one query PER session — a single
 * `ARRAY_CONTAINS(@sessionIds, c.sessionId)` would be a cross-partition query
 * in Cosmos and, bound under a name the mock does not know, every row in the
 * container in tests.
 */
function rostersFor(groupId: string, sessionIds: string[]): Promise<string[][]> {
  return Promise.all(sessionIds.map((id) => rosterNames(groupId, id)));
}

/** Non-removed roster names for one session, lowercased. */
async function rosterFor(groupId: string, sessionId: string): Promise<Set<string>> {
  return new Set((await rosterNames(groupId, sessionId)).map(lower));
}

/**
 * Everyone `name` has shared a recent roster with, excluding themselves.
 * Display names, deduped case-insensitively, in first-seen (newest session)
 * order so the people you just played with come first.
 */
export async function eligibleCoPlayers(groupId: string, name: string, activeSessionId: string): Promise<string[]> {
  const me = lower(name);
  const ids = await recentSessionIds(groupId, activeSessionId);
  const rosters = await rostersFor(groupId, ids);
  const seen = new Set<string>();
  const out: string[] = [];

  // Walked in session order (active, then newest first), whatever order the
  // reads came back in, so the list's order is the one documented above.
  for (const names of rosters) {
    // Only a session I was actually on can make anyone a co-player.
    if (!names.some((n) => lower(n) === me)) continue;
    for (const n of names) {
      if (lower(n) === me || seen.has(lower(n))) continue;
      seen.add(lower(n));
      out.push(n.trim());
    }
  }
  return out;
}

/**
 * Did these two appear in the same logged GAME in this session?
 *
 * The fallback the roster check cannot replace: a roster read can fail, and a
 * walk-up who never signed up is not on one at all, but a logged game is
 * direct evidence they played. Dropping this silently narrowed eligibility
 * when the rule moved into this module — caught by the route test that
 * exercises exactly this path.
 */
async function sharedAGame(groupId: string, a: string, b: string, sessionId: string): Promise<boolean> {
  try {
    await ensureContainer('gameResults', '/sessionId');
    const resources = await groupScope(groupId).query<{ teamA?: string[]; teamB?: string[]; sessionId?: string }>('gameResults', {
      select: 'c.teamA, c.teamB, c.sessionId',
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: sessionId }],
      partitionKey: sessionId,
    });
    for (const g of resources) {
      if (g.sessionId !== sessionId) continue;
      const all = new Set([...(g.teamA ?? []), ...(g.teamB ?? [])].map((n) => lower(String(n))));
      if (all.has(a) && all.has(b)) return true;
    }
  } catch {
    /* No games is not a failure — the roster is the primary proof. */
  }
  return false;
}

/**
 * Did these two share ONE named session — by roster, or by a logged game?
 * The admin-override path of `POST /api/kudos` (which names the session it
 * means) uses this; the player path uses `playedTogetherRecently` below. Same
 * two proofs, so the two paths cannot drift.
 */
export async function playedTogetherIn(groupId: string, aName: string, bName: string, sessionId: string): Promise<boolean> {
  const a = lower(aName);
  const b = lower(bName);
  const roster = await rosterFor(groupId, sessionId);
  if (roster.has(a) && roster.has(b)) return true;
  return sharedAGame(groupId, a, b, sessionId);
}

/**
 * Did these two share a recent session — by roster, or by a logged game?
 *
 * Two phases, each concurrent across every recent session: the rosters first,
 * and the game logs only when no roster proved it. It used to walk the
 * sessions in series and ask BOTH questions of each before moving on, so a
 * pair whose session was three back paid six round trips, and a pair who never
 * played paid eighteen. The roster is the ordinary proof and the game log the
 * rare one (a walk-up, a failed roster read), so asking every roster at once
 * and every game log at once answers the common send in two round trips and
 * the refusal in three, with the same reads the serial walk made at its worst
 * and never a game read a roster had already made unnecessary.
 */
export async function playedTogetherRecently(
  groupId: string,
  aName: string,
  bName: string,
  activeSessionId: string,
): Promise<boolean> {
  const a = lower(aName);
  const b = lower(bName);
  const ids = await recentSessionIds(groupId, activeSessionId);
  const rosters = await rostersFor(groupId, ids);
  if (rosters.some((names) => {
    const roster = new Set(names.map(lower));
    return roster.has(a) && roster.has(b);
  })) return true;
  const games = await Promise.all(ids.map((id) => sharedAGame(groupId, a, b, id)));
  return games.some(Boolean);
}
