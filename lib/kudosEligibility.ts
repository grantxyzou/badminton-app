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
 * Now: anyone who shared a roster with you in a RECENT session.
 */
import { getContainer, ensureContainer } from '@/lib/cosmos';

/**
 * How far back co-play counts. Two months of Thursdays.
 *
 * NOT "ever": `players` is partitioned by `/sessionId`, so an unbounded search
 * is a cross-partition scan of every session the club has held — the shape
 * CLAUDE.md flags for the `club/bands` query. Eight keeps anyone you would
 * plausibly recognise reachable while the cost stays bounded: one bounded
 * `sessions` read, then at most eight `players` reads (plus, on the enforcement
 * path only, up to eight `gameResults` reads before the first match).
 */
export const CO_PLAY_LOOKBACK_SESSIONS = 8;

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Session ids co-play may be proven against: the ACTIVE one first, then recent
 * dated ones.
 *
 * The active id leads because it is the likeliest match — so the common case
 * short-circuits on the first read — and because it is the only way the LEGACY
 * `'current-session'` id is reachable. That id is still live in production
 * (CLAUDE.md) and does not match `session-YYYY-MM-DD`, so a prefix filter alone
 * would silently exclude the very session most people just played.
 */
export async function recentSessionIds(
  activeSessionId: string,
  limit = CO_PLAY_LOOKBACK_SESSIONS,
): Promise<string[]> {
  const ids: string[] = activeSessionId ? [activeSessionId] : [];
  try {
    const { resources } = await getContainer('sessions').items
      // Bounded IN THE QUERY, not only in JS. `sessions` is partitioned by
      // /sessionId, so an unbounded SELECT is a cross-partition scan of every
      // session the club has ever held, on every card mount and every send.
      // The JS sort/slice below stays as the real filter because the mock
      // store ignores SQL entirely; ORDER BY here is what stops real Cosmos
      // reading the whole container. +1 covers the active id being in range.
      .query({ query: `SELECT c.id FROM c ORDER BY c.id DESC OFFSET 0 LIMIT ${limit + 1}` })
      .fetchAll();
    const dated = (resources as { id?: string }[])
      .map((r) => r?.id)
      .filter((id): id is string => typeof id === 'string' && id.startsWith('session-') && id !== activeSessionId)
      // `session-YYYY-MM-DD` sorts lexically in date order — no parsing needed.
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);
    ids.push(...dated);
  } catch {
    /* The active session alone is a correct, if narrower, answer. */
  }
  return ids;
}

/** Non-removed roster names for one session, lowercased. */
async function rosterFor(sessionId: string): Promise<Set<string>> {
  try {
    const { resources } = await getContainer('players').items
      .query({
        query: 'SELECT c.name, c.removed, c.sessionId FROM c WHERE c.sessionId = @sid',
        parameters: [{ name: '@sid', value: sessionId }],
      })
      .fetchAll();
    // The mock store filters by PARAMETER NAME, not SQL, so JS-filter for parity.
    return new Set(
      (resources as { name?: string; removed?: boolean; sessionId?: string }[])
        .filter((p) => p && p.sessionId === sessionId && p.removed !== true && typeof p.name === 'string')
        .map((p) => lower(p.name as string)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Everyone `name` has shared a recent roster with, excluding themselves.
 * Display names, deduped case-insensitively, in first-seen (newest session)
 * order so the people you just played with come first.
 */
export async function eligibleCoPlayers(name: string, activeSessionId: string): Promise<string[]> {
  const me = lower(name);
  const ids = await recentSessionIds(activeSessionId);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const id of ids) {
    try {
      const { resources } = await getContainer('players').items
        .query({
          query: 'SELECT c.name, c.removed, c.sessionId FROM c WHERE c.sessionId = @sid',
          parameters: [{ name: '@sid', value: id }],
        })
        .fetchAll();
      const rows = (resources as { name?: string; removed?: boolean; sessionId?: string }[])
        .filter((p) => p && p.sessionId === id && p.removed !== true && typeof p.name === 'string');
      // Only a session I was actually on can make anyone a co-player.
      if (!rows.some((p) => lower(p.name as string) === me)) continue;
      for (const p of rows) {
        const n = p.name as string;
        if (lower(n) === me || seen.has(lower(n))) continue;
        seen.add(lower(n));
        out.push(n.trim());
      }
    } catch {
      /* Skip this session rather than failing the whole list. */
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
async function sharedAGame(a: string, b: string, sessionId: string): Promise<boolean> {
  try {
    await ensureContainer('gameResults', '/sessionId');
    const { resources } = await getContainer('gameResults').items
      .query({
        query: 'SELECT c.teamA, c.teamB, c.sessionId FROM c WHERE c.sessionId = @sid',
        parameters: [{ name: '@sid', value: sessionId }],
      })
      .fetchAll();
    for (const g of resources as { teamA?: string[]; teamB?: string[]; sessionId?: string }[]) {
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
 * Did these two share a recent session — by roster, or by a logged game?
 * Short-circuits on the first match, so the common case (you played last
 * Thursday, and it is the active session) costs one read.
 */
export async function playedTogetherRecently(
  aName: string,
  bName: string,
  activeSessionId: string,
): Promise<boolean> {
  const a = lower(aName);
  const b = lower(bName);
  for (const id of await recentSessionIds(activeSessionId)) {
    const roster = await rosterFor(id);
    if (roster.has(a) && roster.has(b)) return true;
    if (await sharedAGame(a, b, id)) return true;
  }
  return false;
}
