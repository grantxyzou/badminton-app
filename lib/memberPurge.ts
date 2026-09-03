/**
 * Deleting your own account.
 *
 * THE RULE: remove the person, keep everyone else's records correct.
 *
 * A naive purge deletes every row the member ever wrote. That is the cleanest
 * privacy story and the wrong answer here, because this app's records are
 * SHARED. A `players` row is one line of a cost split — delete it and a night
 * that was divided four ways is suddenly divided three, so an archived receipt
 * stops adding up and `prevCostPerPerson` disagrees with its own session. A
 * `gameResults` row holds four names; delete it and three other people lose a
 * match from their record.
 *
 * So member-scoped data is DELETED and shared history is ANONYMIZED: the row
 * survives with the identity replaced by a tombstone. Arithmetic is preserved,
 * the person is not identifiable, and nothing points back at them.
 *
 * PARTITION KEYS ARE THE HAZARD HERE. `container.item(id, pk)` takes the
 * partition key VALUE, and the mock store IGNORES it — so a wrong value passes
 * every test and silently no-ops against real Cosmos. That is why the tables
 * below record `pk` and `pkField` as DATA: one wrong value is visible in a diff
 * instead of buried in the twelfth hand-written block. The values were read
 * from the `ensureContainer(name, path)` calls, not guessed from call sites.
 *
 * `__tests__/member-purge-coverage.test.ts` fails the build when a container
 * exists that appears in none of the three tables, so this cannot go stale the
 * next time someone adds one.
 */
import { getContainer } from './cosmos';

/** What an anonymized row says instead of a name. */
export const TOMBSTONE_NAME = 'Former member';
/** What an anonymized row says instead of a member id. Never a real id. */
export const TOMBSTONE_MEMBER_ID = 'deleted-member';

interface PurgeTarget {
  container: string;
  /** Partition key PATH as declared to `ensureContainer`. Documentation. */
  pk: string;
  /** Doc field identifying the member. */
  by: 'memberId' | 'recipientMemberId' | 'name';
  /** Doc field supplying the partition key VALUE for `.item(id, pk)`. */
  pkField: 'id' | 'memberId' | 'sessionId' | 'recipientMemberId';
  /** Case-insensitive match — for the name-keyed containers. */
  ci?: boolean;
}

/**
 * Owned by one member and meaningful to nobody else. Deleted outright.
 */
const OWNED: readonly PurgeTarget[] = [
  { container: 'identities', pk: '/id', by: 'memberId', pkField: 'id' },
  // Rule 10: e-transfer names are sensitive payment data. Scoped to the
  // caller's OWN memberId — never a name fallback.
  { container: 'aliases', pk: '/id', by: 'memberId', pkField: 'id' },
  { container: 'assessments', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  { container: 'insights', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  { container: 'playerGear', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  { container: 'pushSubscriptions', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  /* Deleting these MOVES AN ANALYTICS NUMBER, and that is accepted, not
     overlooked. `events` is the append-only history behind the Value-Hub
     Slice-0 kill-criterion ("did a member interact more than once?"), read via
     GET /api/admin/slice0. Purging a member's events retroactively lowers it.

     Anonymizing instead would be worse, not better: collapsing every deleted
     member onto one tombstone id would merge their events into a single
     fictional member with an inflated count, which corrupts the metric rather
     than reducing it. A smaller true number beats a larger false one, and
     someone's engagement trail is personal data besides. The caveat is
     repeated at the point the number is READ, which is where it can mislead. */
  { container: 'events', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  { container: 'drillCompletions', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  { container: 'stringingJobs', pk: '/memberId', by: 'memberId', pkField: 'memberId' },
  // Kudos RECEIVED are about them. Kudos they GAVE are part of someone else's
  // count and are anonymized instead — see below.
  { container: 'kudos', pk: '/recipientMemberId', by: 'recipientMemberId', pkField: 'recipientMemberId' },
  // Skill scores are keyed by roster NAME, not memberId (PK is /sessionId).
  { container: 'skills', pk: '/sessionId', by: 'name', pkField: 'sessionId', ci: true },
  /* SHORT-LIVED IS NOT THE SAME AS HARMLESS. This parks a `memberId` against a
     hashed ref for ten minutes while an OAuth handoff is in flight. It expires
     on its own, so purging it changes little in practice — but "it would have
     expired anyway" is not an answer to "is this member's id still in your
     database after they asked you to delete it".

     It was INVISIBLE to the coverage canary until 2026-08-28 because it
     references its container through `const CONTAINER = '…'` rather than a
     literal, and the canary only matched quoted arguments — so it survived a
     deletion request in the first cut of this file. */
  { container: 'authhandoff', pk: '/id', by: 'memberId', pkField: 'id' },
  /* Same family: a five-minute stash holding a memberId while a PWA→native
     migration link is in flight (lib/authMigration.ts). Also a `const
     CONTAINER` alias, which is why the canary resolves those now. */
  { container: 'authmigration', pk: '/id', by: 'memberId', pkField: 'id' },
];

/** Names only — for the coverage canary, which must not import the table shape. */
export const OWNED_CONTAINERS: readonly string[] = OWNED.map((t) => t.container);

/**
 * Containers that genuinely hold nothing about any individual member.
 *
 * Listed explicitly, with a reason, so the coverage canary can tell
 * "considered and excluded" from "forgotten".
 */
export const NOT_MEMBER_SCOPED: Readonly<Record<string, string>> = {
  sessions: 'club-wide session records; player identity lives in `players`',
  announcements: 'written by an admin to the whole club',
  birds: 'shuttle purchases and stock adjustments — club inventory',
  clubSettings: 'shop sign, stocked strings, rate card — club-wide',
  equipmentCatalog: 'the racket/string catalog; seeded, not user data',
  releases: 'changelog entries',
};

/**
 * Containers that DO hold member data and are handled by a dedicated function
 * rather than the `OWNED` table.
 *
 * Kept separate from `NOT_MEMBER_SCOPED` because folding them in there made the
 * name assert something false: four of these are personal data, and a future
 * reader trusting "not member scoped" would conclude a deletion request does
 * not have to touch them. The canary accepts either list; the distinction is
 * for the human.
 */
export const CLASSIFIED_ELSEWHERE: Readonly<Record<string, string>> = {
  members: 'the member row itself — deleted directly by the route',
  players: 'shared cost history — `anonymizePlayerRows`',
  gameResults: 'shared match history — `anonymizeGameResults`',
  feedback: 'reports carry a name and an IP — `anonymizeFeedback`',
};

export interface PurgeSummary {
  deleted: number;
  anonymized: number;
  /** Containers that threw. The purge continues past them — a partial delete
   *  that reports what it missed beats one that gives up holding the rest. */
  failed: string[];
}

/**
 * PARAMETER NAMES ARE LOAD-BEARING, and not for the reason you would guess.
 *
 * The mock store (`lib/cosmos.ts`) does not parse SQL. It applies a filter per
 * recognised PARAMETER NAME — `@sessionId`, `@memberId`, `@name` — and an
 * unrecognised name means NO filter, so the query silently returns every row in
 * the container. For a read that is a confusing test; for a purge it is a
 * container-emptying bug that passes CI.
 *
 * So every query here uses the conventional name for its field, AND every
 * caller re-checks the predicate in JS before deleting. Filtering twice is
 * idempotent and costs nothing; deleting a row that a query should never have
 * returned is unrecoverable.
 */
async function queryAll(
  container: string,
  where: string,
  params: { name: string; value: string }[],
  /** Re-check in JS. A row that fails this is never touched. */
  predicate: (row: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>[]> {
  const { resources } = await getContainer(container)
    .items.query({ query: `SELECT * FROM c WHERE ${where}`, parameters: params })
    .fetchAll();
  return ((resources ?? []) as Record<string, unknown>[]).filter(predicate);
}

const sameName = (row: Record<string, unknown>, lower: string) =>
  typeof row.name === 'string' && row.name.trim().toLowerCase() === lower;

/**
 * Delete every row a member owns, then anonymize the shared rows that name
 * them, then delete the member document itself.
 *
 * Never throws: it is called from a route that has already decided the account
 * is going away, and a container that fails should not strand the rest.
 */
export async function purgeMember(memberId: string, name: string): Promise<PurgeSummary> {
  const summary: PurgeSummary = { deleted: 0, anonymized: 0, failed: [] };
  const lowerName = name.trim().toLowerCase();

  for (const t of OWNED) {
    try {
      const byName = t.by === 'name';
      const where = byName
        ? t.ci
          ? 'LOWER(c.name) = @name'
          : 'c.name = @name'
        : `c.${t.by} = @${t.by}`;
      const value = byName ? lowerName : memberId;
      const rows = await queryAll(
        t.container,
        where,
        [{ name: byName ? '@name' : `@${t.by}`, value }],
        (row) => (byName ? sameName(row, lowerName) : row[t.by] === memberId),
      );
      for (const row of rows) {
        await getContainer(t.container)
          .item(String(row.id), String(row[t.pkField]))
          .delete();
        summary.deleted += 1;
      }
    } catch (err) {
      console.error(`[purge] ${t.container} failed:`, err);
      summary.failed.push(t.container);
    }
  }

  // Kudos they GAVE: the recipient earned those, so the row stays and only the
  // giver's identity is replaced. `raterMemberId` becomes a non-id so the
  // one-kudos-per-rater-per-session dedup can never match a real member again.
  try {
    const given = await queryAll(
      'kudos',
      'c.raterMemberId = @raterMemberId',
      [{ name: '@raterMemberId', value: memberId }],
      (row) => row.raterMemberId === memberId,
    );
    for (const row of given) {
      await getContainer('kudos').items.upsert({
        ...row,
        raterMemberId: TOMBSTONE_MEMBER_ID,
        raterName: TOMBSTONE_NAME,
      });
      summary.anonymized += 1;
    }
  } catch (err) {
    console.error('[purge] kudos (given) failed:', err);
    summary.failed.push('kudos:given');
  }

  return summary;
}

/**
 * `players` rows, split by whether the session has already happened.
 *
 * ACTIVE session → soft-remove, which frees the spot for someone else. That is
 * the existing idiom (`removed: true`), and it matters: a deleted account
 * holding a seat at Thursday's session would keep a real person on the
 * waitlist.
 *
 * PAST sessions → anonymize, so the split still balances.
 *
 * Either way the row's CREDENTIALS go. `deleteToken` on an anonymized row is a
 * live credential belonging to a deleted account, and the `pinHash` mirror is
 * the same fields at rest that the strip-canary rule keeps out of responses.
 */
export async function anonymizePlayerRows(
  memberId: string,
  name: string,
  activeSessionId: string,
): Promise<{ removed: number; anonymized: number }> {
  const lowerName = name.trim().toLowerCase();
  /* TWO QUERIES, NOT ONE `OR`. Rows written before the memberId migration
     carry only a name, and rows written since carry both — so both are needed.
     They are kept separate because the mock store applies one filter per
     parameter NAME and would AND them, silently dropping every legacy row,
     while real Cosmos would OR them. One query that means two different things
     in two environments is worse than two that mean the same thing in both. */
  const byId = await queryAll(
    'players',
    'c.memberId = @memberId',
    [{ name: '@memberId', value: memberId }],
    (row) => row.memberId === memberId,
  );
  const byName = await queryAll(
    'players',
    'LOWER(c.name) = @name',
    [{ name: '@name', value: lowerName }],
    (row) => sameName(row, lowerName),
  );
  const seen = new Set<string>();
  const rows = [...byId, ...byName].filter((r) => {
    const id = String(r.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  let removed = 0;
  let anonymized = 0;
  for (const row of rows) {
    const {
      deleteToken: _dt,
      pinHash: _ph,
      memberId: _mid,
      ...rest
    } = row as Record<string, unknown>;

    if (row.sessionId === activeSessionId) {
      await getContainer('players').items.upsert({
        ...rest,
        name: TOMBSTONE_NAME,
        removed: true,
        removedAt: new Date().toISOString(),
      });
      removed += 1;
    } else {
      await getContainer('players').items.upsert({ ...rest, name: TOMBSTONE_NAME });
      anonymized += 1;
    }
  }
  return { removed, anonymized };
}

/**
 * `gameResults` holds four player NAMES per row. Rewrite this member's name
 * wherever it appears; never delete the row, or three other people lose a match
 * from their record.
 */
export async function anonymizeGameResults(name: string): Promise<number> {
  const lowerName = name.trim().toLowerCase();
  const matches = (list: unknown): string[] =>
    Array.isArray(list)
      ? (list as string[]).map((n) =>
          typeof n === 'string' && n.trim().toLowerCase() === lowerName ? TOMBSTONE_NAME : n,
        )
      : [];

  // No memberId on these rows, so there is nothing to filter on server-side:
  // read and rewrite the ones that name this player.
  const namesThisPlayer = (row: Record<string, unknown>) =>
    [...(Array.isArray(row.teamA) ? row.teamA : []), ...(Array.isArray(row.teamB) ? row.teamB : [])]
      .some((n) => typeof n === 'string' && n.trim().toLowerCase() === lowerName) ||
    (typeof row.loggedBy === 'string' && row.loggedBy.trim().toLowerCase() === lowerName);

  const rows = await queryAll('gameResults', 'IS_DEFINED(c.sessionId)', [], namesThisPlayer);
  let n = 0;
  for (const row of rows) {
    const teamA = matches(row.teamA);
    const teamB = matches(row.teamB);
    const loggedBy =
      typeof row.loggedBy === 'string' && row.loggedBy.trim().toLowerCase() === lowerName
        ? TOMBSTONE_NAME
        : row.loggedBy;
    const changed =
      JSON.stringify(teamA) !== JSON.stringify(row.teamA) ||
      JSON.stringify(teamB) !== JSON.stringify(row.teamB) ||
      loggedBy !== row.loggedBy;
    if (!changed) continue;
    await getContainer('gameResults').items.upsert({ ...row, teamA, teamB, loggedBy });
    n += 1;
  }
  return n;
}

/**
 * Problem reports carry an optional reporter name AND the submitting IP. Both
 * are personal data; the report text is operational and stays.
 */
export async function anonymizeFeedback(name: string): Promise<number> {
  const lowerName = name.trim().toLowerCase();
  const rows = await queryAll(
    'feedback',
    'LOWER(c.name) = @name',
    [{ name: '@name', value: lowerName }],
    (row) => sameName(row, lowerName),
  );
  for (const row of rows) {
    const { ip: _ip, ...rest } = row as Record<string, unknown>;
    await getContainer('feedback').items.upsert({ ...rest, name: TOMBSTONE_NAME });
  }
  return rows.length;
}
