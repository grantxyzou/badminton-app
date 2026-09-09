/**
 * Group scoping — which containers belong to a GROUP, which to a PERSON, and
 * which are one copy for the whole deployment.
 *
 * Phase 0 of `docs/plans/multi-group.md`. Nothing here changes behaviour yet;
 * it is the classification every later phase leans on, written as DATA so a
 * wrong decision is visible in a diff, in the same shape as `lib/memberPurge.ts`
 * and for the same reason: a table is only as good as the day it was written,
 * and `__tests__/group-scope-coverage.test.ts` fails the build when a container
 * appears in none of the three tables (or in two).
 *
 * THE RULE THAT MAKES ROLLBACK SAFE: BPM's existing ids are NEVER rewritten.
 * Group #1 (`'bpm'`) keeps `session-YYYY-MM-DD`, `active-session-pointer` and
 * the `stringing*` settings ids exactly as production holds them today; only a
 * NEW group gets a `${groupId}:` prefix (`groupDocId`). `groupId` itself is an
 * additive optional FIELD — Cosmos partition keys are immutable, so it is
 * filtered in queries, never made a key. Older code redeployed against the
 * migrated database reads it as an unknown field and carries on.
 *
 * THE MOCK-STORE TRAP, closed here rather than discovered later: the mock
 * (`lib/cosmos.ts`) filters by PARAMETER NAME from a closed allowlist, and an
 * unrecognised name means NO filter — every row comes back. An isolation test
 * written before the mock knew `@groupId` would pass because the fixture only
 * held one group. The mock now calls `matchesGroup`, and whether it admits an
 * UNSTAMPED row follows the QUERY TEXT — only `groupClause(true)`'s marker
 * does — so a plain `c.groupId = @groupId` means the same thing in the mock
 * as in Cosmos. (A first cut keyed the mock on the constant alone, which made
 * it laxer than production: legacy rows came back in tests for a clause that
 * excludes them in Cosmos.)
 */

import type { SqlParameter } from '@azure/cosmos';
import { CONTAINERS, containersOfScope, pkFieldOf, type ContainerScope, type ContainersOfScope } from './containers';
// A cycle with ./cosmos, and a safe one: neither module touches the other's
// exports at evaluation time, only inside functions.
import { getContainer, POINTER_ID } from './cosmos';

/** Group #1. Every row in production today belongs to it. */
export const BPM_GROUP_ID = 'bpm';

/**
 * Transition tolerance. While `true`, a row with NO `groupId` is read as BPM's
 * — production data predates the field, and the backfill
 * (`POST /api/admin/migrate-groups`, Phase 2) stamps it in place. Flip to
 * `false` in Phase 5, only after that route's status read has shown zero
 * unstamped rows in every group-scoped container for a week.
 */
export const TOLERATE_UNSTAMPED = true;

/**
 * The three tables are VIEWS of `lib/containers.ts` (name → reason), which is
 * where the scope, the partition key and the reason are recorded together.
 * They are kept as named exports because the canaries and the docs refer to
 * the three kinds by these names.
 */
function reasonsOfScope<S extends ContainerScope>(scope: S): Readonly<Record<ContainersOfScope<S>, string>> {
  const out = {} as Record<ContainersOfScope<S>, string>;
  for (const name of containersOfScope(scope)) out[name] = CONTAINERS[name].reason;
  return out;
}

/**
 * Filtered by `groupId` on every read, stamped on every write. Once the scoped
 * accessor lands (Phase 1) raw `getContainer` on one of these is a build error
 * outside an allowlist.
 */
export const GROUP_SCOPED = reasonsOfScope('group');

/**
 * Keyed by the person; never filtered by group. Raw `getContainer` stays
 * allowed — but any club AGGREGATE over one of these (`stats/club/*`, the
 * level calibration, the sign-ups-open push broadcast) must be narrowed to the
 * group's roster first, or "the club" silently means "the database".
 */
export const PERSON_SCOPED = reasonsOfScope('person');

/** One copy for the whole deployment. */
export const GLOBAL = reasonsOfScope('global');

export type GroupContainer = ContainersOfScope<'group'>;

/**
 * Document id for a group-scoped singleton or date-keyed doc. BPM keeps the
 * legacy id; any other group is prefixed. `sessions` has `id === sessionId ===
 * PK`, so without this two groups playing the same date would 409 on create.
 */
export function groupDocId(groupId: string, id: string): string {
  return groupId === BPM_GROUP_ID ? id : `${groupId}:${id}`;
}

/** The prefix every session id in a group starts with — replaces `startsWith('session-')`. */
export function sessionPrefix(groupId: string): string {
  return groupDocId(groupId, 'session-');
}

/** The SQL text the mock recognises as the tolerant clause. One string, one owner. */
const UNSTAMPED_MARKER = 'NOT IS_DEFINED(c.groupId)';

/**
 * The WHERE fragment that scopes a query to `@groupId` (the caller still
 * binds the parameter). An unstamped row can only ever be BPM's, so the OR arm
 * is emitted only for BPM and only while tolerant; every other group, and BPM
 * after Phase 5, gets plain equality.
 *
 * The mock store keys its own tolerance on the PRESENCE of this clause's
 * marker in the query text, not on the constant alone — so a plain
 * `c.groupId = @groupId` excludes unstamped rows in the mock exactly as it
 * does in Cosmos. Without that, a query that returned BPM's history in tests
 * would return nothing in production, which is the mock-laxer-than-Cosmos
 * trap this repo has been burned by twice.
 */
export function groupClause(groupId: string, tolerate: boolean = TOLERATE_UNSTAMPED): string {
  return tolerate && groupId === BPM_GROUP_ID
    ? `(c.groupId = @groupId OR ${UNSTAMPED_MARKER})`
    : 'c.groupId = @groupId';
}

/** Whether a query's text carries the tolerant clause. For the mock store. */
export function queryToleratesUnstamped(sql: string): boolean {
  return sql.includes(UNSTAMPED_MARKER);
}

/**
 * Does this row belong to `groupId`? The single predicate the mock store uses
 * for `@groupId`, and that the scoped accessor will re-check in JS on every
 * returned row (belt and braces against a query that forgot the clause).
 */
export function matchesGroup(
  row: { groupId?: unknown },
  groupId: string,
  tolerate: boolean = TOLERATE_UNSTAMPED,
): boolean {
  if (row.groupId === groupId) return true;
  return tolerate && row.groupId === undefined && groupId === BPM_GROUP_ID;
}

// ---------------------------------------------------------------------------
// The scoped accessor — the only way a route reads or writes a GROUP_SCOPED
// container once the Phase 1 sweep is done.
//
// Three independent layers against a cross-group leak:
//   1. `buildGroupQuery` always emits the group clause. A builder, not SQL
//      rewriting: appending to arbitrary SQL breaks on ORDER BY / OFFSET and on
//      the thirty scans that had no WHERE at all; the builder makes those
//      scoped by construction.
//   2. Every returned row is re-checked in JS by `matchesGroup`, and a mismatch
//      is dropped with a `[group-leak]` log — the sentinel the test suite
//      asserts never fires. This is what makes the mock-store trap moot on the
//      accessor path: even a query that somehow bypassed the clause cannot
//      hand back another group's row.
//   3. Writes are stamped with the SCOPE's group, never the caller's.
//
// Partition keys come from the registry (`pkFieldOf`), so a caller supplies
// the key VALUE only when it is not the id — and never the path.
// ---------------------------------------------------------------------------

export interface GroupQuery {
  /** Projection, default `*`. `c.groupId` is appended to a field list so rows can be verified. */
  select?: string;
  /** WHERE fragment WITHOUT the keyword; wrapped in parentheses. May reference `params`. */
  where?: string;
  /** Caller parameters. `@groupId` and `@pointerId` are the builder's; naming one throws. */
  params?: SqlParameter[];
  /** e.g. `c.id DESC`. */
  orderBy?: string;
  /** Emitted as `OFFSET 0 LIMIT n`. */
  limit?: number;
}

const RESERVED_PARAMS = new Set(['@groupId', '@pointerId']);

export function buildGroupQuery(
  groupId: string,
  container: GroupContainer,
  q: GroupQuery,
): { query: string; parameters: SqlParameter[] } {
  for (const p of q.params ?? []) {
    if (RESERVED_PARAMS.has(p.name)) {
      throw new Error(`buildGroupQuery: ${p.name} is bound by the accessor; pick another name`);
    }
  }
  const select = q.select?.trim() || '*';
  const isValue = /^VALUE\b/i.test(select);
  const projection = select === '*' || isValue ? select : `${select}, c.groupId`;

  const clauses = [groupClause(groupId)];
  const parameters: SqlParameter[] = [...(q.params ?? [])];
  if (container === 'sessions') {
    // The pointer is a row in `sessions`, stamped with its group and carrying
    // no datetime; without this it comes back as "a session" in every list.
    clauses.push('c.id != @pointerId');
    parameters.push({ name: '@pointerId', value: groupDocId(groupId, POINTER_ID) });
  }
  if (q.where?.trim()) clauses.push(`(${q.where.trim()})`);
  parameters.push({ name: '@groupId', value: groupId });

  let sql = `SELECT ${projection} FROM c WHERE ${clauses.join(' AND ')}`;
  if (q.orderBy) sql += ` ORDER BY ${q.orderBy}`;
  if (q.limit !== undefined) sql += ` OFFSET 0 LIMIT ${Math.max(0, Math.floor(q.limit))}`;
  return { query: sql, parameters };
}

/** Anything with an id. Typed interfaces (GameResult, PlayerSkills…) have no index signature, so no Record here. */
type Doc = { id: string };

export interface GroupScope {
  readonly groupId: string;
  query<T = Record<string, unknown>>(container: GroupContainer, q?: GroupQuery): Promise<T[]>;
  count(container: GroupContainer, where?: string, params?: SqlParameter[]): Promise<number>;
  /** Point read. `pkValue` is required unless the registry says the key is `/id`. */
  read<T extends Doc = Doc>(container: GroupContainer, id: string, pkValue?: string): Promise<T | undefined>;
  create<T extends Doc>(container: GroupContainer, doc: T): Promise<T>;
  upsert<T extends Doc>(container: GroupContainer, doc: T): Promise<T>;
  /** Read-verify, then delete. A doc of another group is left alone. */
  remove(container: GroupContainer, id: string, pkValue?: string): Promise<boolean>;
}

export function groupScope(groupId: string): GroupScope {
  const tolerate = TOLERATE_UNSTAMPED;

  function keep<T>(container: GroupContainer, rows: unknown[]): T[] {
    const out: T[] = [];
    for (const row of rows) {
      if (row && typeof row === 'object' && matchesGroup(row as { groupId?: unknown }, groupId, tolerate)) {
        out.push(row as T);
      } else {
        console.error(`[group-leak] ${container}: a row outside group ${groupId} reached the accessor`, {
          id: (row as { id?: unknown } | null)?.id,
        });
      }
    }
    return out;
  }

  function pkValueFor(container: GroupContainer, id: string, pkValue: string | undefined): string {
    if (pkFieldOf(container) === 'id') return id;
    if (pkValue === undefined) {
      throw new Error(`groupScope.${container}: partition key value (${pkFieldOf(container)}) is required`);
    }
    return pkValue;
  }

  const scope: GroupScope = {
    groupId,

    async query<T = Record<string, unknown>>(container: GroupContainer, q: GroupQuery = {}): Promise<T[]> {
      const built = buildGroupQuery(groupId, container, q);
      const { resources } = await getContainer(container).items.query(built).fetchAll();
      const isValue = /^VALUE\b/i.test(q.select?.trim() ?? '');
      return isValue ? ((resources ?? []) as T[]) : keep<T>(container, resources ?? []);
    },

    async count(container, where, params) {
      const rows = await scope.query<number>(container, { select: 'VALUE COUNT(1)', where, params });
      return typeof rows[0] === 'number' ? rows[0] : 0;
    },

    async read<T extends Doc = Doc>(container: GroupContainer, id: string, pkValue?: string): Promise<T | undefined> {
      const pk = pkValueFor(container, id, pkValue);
      const { resource } = await getContainer(container).item(id, pk).read();
      if (!resource) return undefined;
      return keep<T>(container, [resource])[0];
    },

    async create<T extends Doc>(container: GroupContainer, doc: T): Promise<T> {
      const { resource } = await getContainer(container).items.create({ ...doc, groupId });
      return (resource ?? { ...doc, groupId }) as T;
    },

    async upsert<T extends Doc>(container: GroupContainer, doc: T): Promise<T> {
      const { resource } = await getContainer(container).items.upsert({ ...doc, groupId });
      return (resource ?? { ...doc, groupId }) as T;
    },

    async remove(container, id, pkValue) {
      const pk = pkValueFor(container, id, pkValue);
      const existing = await scope.read(container, id, pk);
      if (!existing) return false;
      await getContainer(container).item(id, pk).delete();
      return true;
    },
  };
  return scope;
}
