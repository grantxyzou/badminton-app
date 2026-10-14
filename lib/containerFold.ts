/**
 * THE CONTAINER FOLD — copying two small containers into the cabinets that
 * now hold their kind (`docs/plans/container-fold.md`):
 *
 *   `aliases`  → `clubSettings`  as `kind: 'alias'`     (GROUP, `/id`)
 *   `feedback` → `releases`      as `kind: 'feedback'`  (GLOBAL, `/id`)
 *
 * plus stamping `kind: 'release'` on the changelog rows that predate the
 * field, so the release reader can one day be strict. `authmigration` is
 * not here: its docs live five minutes, so the code simply writes new ones
 * to `authhandoff` and the old container empties itself.
 *
 * IDEMPOTENT, LIKE THE GROUP BACKFILL. A row is copied under its OLD id, so a
 * second run's `create` 409s and is counted `existing`; "run until the status
 * reads zero remaining" is the whole procedure. BOUNDED the same way: a scan
 * cap, because a request has 230s on App Service — though both containers
 * hold dozens of rows, not thousands, and the cap is form.
 *
 * RAW ACCESS ON PURPOSE. This reads every row of two group containers
 * across every club, which is what `groupScope()` exists to prevent; the file
 * is on `RAW_ACCESS_ALLOWLIST` for the same reason `lib/groupBackfill.ts` is,
 * and is deleted with the route once the old containers are gone (PR 2).
 *
 * THE MOCK-STORE TRAP, avoided: the status counts in JS from fetched rows,
 * never with `VALUE COUNT`, because the mock applies no WHERE.
 */
import { ensureContainer, getContainer } from './cosmos';
import type { ContainerName } from './containers';
import { BPM_GROUP_ID } from './groupScope';
import { ALIAS_KIND } from './aliases';
import { FEEDBACK_HOME, FEEDBACK_KIND, RELEASE_KIND } from './feedback';

export const FOLD_SCAN_CAP = 2000;

type Row = Record<string, unknown> & { id: string };

interface Move {
  name: 'aliases' | 'feedback';
  from: ContainerName;
  to: ContainerName;
  kind: string;
  /** What the copied row carries that the original did not. */
  stamp: (row: Row) => Row;
}

const MOVES: readonly Move[] = [
  {
    name: 'aliases',
    from: 'aliases',
    to: 'clubSettings',
    kind: ALIAS_KIND,
    // A pre-backfill alias may carry no group; the tolerant clause has read
    // it as BPM's all along, so the copy says so outright.
    stamp: (row) => ({ ...row, kind: ALIAS_KIND, groupId: typeof row.groupId === 'string' ? row.groupId : BPM_GROUP_ID }),
  },
  { name: 'feedback', from: 'feedback', to: FEEDBACK_HOME, kind: FEEDBACK_KIND, stamp: (row) => ({ ...row, kind: FEEDBACK_KIND }) },
];

export interface MoveStatus {
  /** Rows still in the old container (up to the cap). */
  legacy: number;
  /** Of those, how many already have a copy in the new home. */
  copied: number;
  remaining: number;
  truncated: boolean;
}

export interface FoldStatus {
  aliases: MoveStatus;
  feedback: MoveStatus;
  releases: { unstamped: number; truncated: boolean };
  scanCap: number;
}

export interface FoldSummary {
  dryRun: boolean;
  aliases: { copied: number; existing: number; remaining: number };
  feedback: { copied: number; existing: number; remaining: number };
  releases: { stamped: number; conflicts: number };
}

/** Cosmos's own fields; a copy must not carry another container's etag. */
function strip(row: Row): Row {
  const { _rid: _r, _self: _s, _etag: _e, _attachments: _a, _ts: _t, ...rest } = row;
  return rest as Row;
}

async function readAll(container: ContainerName, cap: number): Promise<{ rows: Row[]; truncated: boolean }> {
  await ensureContainer(container, '/id');
  const { resources } = await getContainer(container).items.query<Row>({ query: 'SELECT * FROM c' }).fetchAll();
  const all = (resources ?? []).filter((r) => r && typeof r.id === 'string');
  return { rows: all.slice(0, cap), truncated: all.length > cap };
}

/** Ids of the rows of one kind in a shared home — the "already copied" set. */
async function idsOfKind(container: ContainerName, kind: string): Promise<Set<string>> {
  await ensureContainer(container, '/id');
  const { resources } = await getContainer(container).items
    .query<Row>({ query: `SELECT c.id, c.kind FROM c WHERE c.kind = '${kind}'` })
    .fetchAll();
  return new Set((resources ?? []).filter((r) => r.kind === kind).map((r) => r.id));
}

async function moveStatus(move: Move, cap: number): Promise<MoveStatus> {
  const [{ rows, truncated }, done] = await Promise.all([readAll(move.from, cap), idsOfKind(move.to, move.kind)]);
  const copied = rows.filter((r) => done.has(r.id)).length;
  return { legacy: rows.length, copied, remaining: rows.length - copied, truncated };
}

/** Changelog rows written before `kind` existed. */
async function unstampedReleases(cap: number): Promise<{ rows: Row[]; truncated: boolean }> {
  const { rows, truncated } = await readAll(FEEDBACK_HOME, cap);
  return { rows: rows.filter((r) => r.kind === undefined), truncated };
}

export async function foldStatus(opts: { scanCap?: number } = {}): Promise<FoldStatus> {
  const cap = opts.scanCap ?? FOLD_SCAN_CAP;
  const [aliases, feedback, releases] = await Promise.all([moveStatus(MOVES[0], cap), moveStatus(MOVES[1], cap), unstampedReleases(cap)]);
  return { aliases, feedback, releases: { unstamped: releases.rows.length, truncated: releases.truncated }, scanCap: cap };
}

async function runMove(move: Move, dryRun: boolean, cap: number): Promise<FoldSummary['aliases']> {
  const [{ rows }, done] = await Promise.all([readAll(move.from, cap), idsOfKind(move.to, move.kind)]);
  const out = { copied: 0, existing: 0, remaining: 0 };
  for (const row of rows) {
    if (done.has(row.id)) {
      out.existing += 1;
      continue;
    }
    if (dryRun) {
      out.remaining += 1;
      continue;
    }
    try {
      await getContainer(move.to).items.create(move.stamp(strip(row)));
      out.copied += 1;
    } catch (err) {
      // A copy that landed between the status read and this write.
      if ((err as { code?: number }).code === 409) out.existing += 1;
      else throw err;
    }
  }
  return out;
}

export async function runFold(opts: { dryRun: boolean; scanCap?: number }): Promise<FoldSummary> {
  const cap = opts.scanCap ?? FOLD_SCAN_CAP;
  const aliases = await runMove(MOVES[0], opts.dryRun, cap);
  const feedback = await runMove(MOVES[1], opts.dryRun, cap);
  const releases = { stamped: 0, conflicts: 0 };
  const { rows } = await unstampedReleases(cap);
  for (const row of rows) {
    if (opts.dryRun) {
      releases.stamped += 1;
      continue;
    }
    const { _etag, ...rest } = row as Row & { _etag?: string };
    try {
      // Under the etag the scan returned: a release edited in between is a
      // conflict for the next run, never an overwrite.
      await getContainer(FEEDBACK_HOME)
        .item(row.id, row.id)
        .replace({ ...rest, kind: RELEASE_KIND }, _etag ? { accessCondition: { type: 'IfMatch', condition: _etag } } : undefined);
      releases.stamped += 1;
    } catch {
      releases.conflicts += 1;
    }
  }
  return { dryRun: opts.dryRun, aliases, feedback, releases };
}
