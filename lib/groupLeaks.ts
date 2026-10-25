import { createHash } from 'crypto';
import { ensureContainer, getContainer } from './cosmos';

/**
 * WHAT A GROUP LEAK WAS, KEPT (multi-group Phase 5, 2026-10-24).
 *
 * `groupScope()` re-checks every query row in JS and DROPS one that belongs to
 * another club, so nothing reaches the reader. Until today the only trace was
 * a `[group-leak]` line in the App Service log stream, which someone had to be
 * watching. Grant: "dont ask me to monitor group leak until there is a second
 * group created and completed one end to end. Also track what got leaked."
 *
 * So each drop is also written down: one record per distinct (container,
 * asking club, row id), never the row's contents. That is enough to find the
 * query whose clause let the row through, and nothing a member could be
 * named by. The operator reads them on `GET /api/admin/migrate-groups`
 * (`leaks`), so checking is one request on the day a second club has run a
 * full session — not a log stream watched for a week.
 *
 * WHERE: the GLOBAL `groups` container, as `kind: 'groupLeak'` beside the
 * invite docs. A leak is about two clubs at once, so it cannot live inside
 * either; that container is read by id and never listed to a member; and the
 * database is at its container cap.
 *
 * Best-effort by design, like the event beacons: the read that found the leak
 * has already been answered correctly (the row was dropped), so a failed
 * write logs and changes nothing a person sees. It never throws.
 */

export const GROUP_LEAK_KIND = 'groupLeak';

export interface GroupLeakRecord {
  id: string;
  kind: typeof GROUP_LEAK_KIND;
  /** The group container the query read. */
  container: string;
  /** The club that ran the query and would have received the row. */
  askedGroup: string;
  /** The club the row belongs to; null when the row carried no `groupId`. */
  rowGroup: string | null;
  /** The row's own id, to find it; null when it had none. */
  rowId: string | null;
  firstSeen: string;
}

/** The record's id: one per distinct leak, so a leak repeated on every request is one record. */
export function groupLeakId(container: string, askedGroup: string, rowId: string | null): string {
  const digest = createHash('sha256').update(`${container}|${askedGroup}|${rowId ?? ''}`).digest('hex');
  return `leak:${digest.slice(0, 32)}`;
}

/**
 * Leaks already written by THIS process, so a leak on a hot path costs one
 * write rather than one per request. Bounded; cleared when full. A second
 * instance writes its own first sighting, which the store refuses as a
 * duplicate id.
 */
const recorded = new Set<string>();
const RECORDED_CAP = 500;

/** Test hook: forget what this process has written. */
export function resetGroupLeakMemo(): void {
  recorded.clear();
}

/**
 * Write down one dropped row. Resolves when the write settles; never rejects.
 * Callers on a hot path do not await it.
 */
export async function recordGroupLeak(container: string, askedGroup: string, row: unknown): Promise<void> {
  const r = row && typeof row === 'object' ? (row as { id?: unknown; groupId?: unknown }) : null;
  const rowId = typeof r?.id === 'string' ? r.id.slice(0, 200) : null;
  const rowGroup = typeof r?.groupId === 'string' ? r.groupId.slice(0, 100) : null;
  const id = groupLeakId(container, askedGroup, rowId);
  if (recorded.has(id)) return;
  if (recorded.size >= RECORDED_CAP) recorded.clear();
  recorded.add(id);

  const doc: GroupLeakRecord = {
    id,
    kind: GROUP_LEAK_KIND,
    container,
    askedGroup: askedGroup.slice(0, 100),
    rowGroup,
    rowId,
    firstSeen: new Date().toISOString(),
  };
  try {
    await ensureContainer('groups', '/id');
    await getContainer('groups').items.create(doc);
  } catch (err) {
    // 409: already recorded — by another instance, or before a restart.
    if ((err as { code?: number })?.code === 409) return;
    recorded.delete(id);
    // A constant message (CodeQL's tainted-format rule), and deliberately NOT
    // the `[group-leak]` prefix: this is a bookkeeping failure, not a leak.
    console.error('[leak-record] could not save a group leak record', { container, id });
  }
}

export interface GroupLeakReport {
  /** Distinct leaks on record, up to the read cap. */
  total: number;
  /** True when there are more than the cap; `total` is then a floor. */
  truncated: boolean;
  /** The most recent first sightings, newest first. */
  latest: GroupLeakRecord[];
}

const READ_CAP = 500;
const LATEST_SHOWN = 25;

/** Every leak record, for the operator's status read. Throws on a failed read. */
export async function readGroupLeaks(): Promise<GroupLeakReport> {
  await ensureContainer('groups', '/id');
  const { resources } = await getContainer('groups')
    .items.query<Record<string, unknown>>({
      query: `SELECT * FROM c WHERE c.kind = @kind OFFSET 0 LIMIT ${READ_CAP + 1}`,
      parameters: [{ name: '@kind', value: GROUP_LEAK_KIND }],
    })
    .fetchAll();
  // Re-checked in JS: the mock store filters by parameter NAME and applies no
  // WHERE it does not know, so the kind test is what holds under test.
  const rows: GroupLeakRecord[] = resources
    .filter((r) => r.kind === GROUP_LEAK_KIND && typeof r.id === 'string')
    .map((r) => ({
      id: r.id as string,
      kind: GROUP_LEAK_KIND,
      container: String(r.container ?? ''),
      askedGroup: String(r.askedGroup ?? ''),
      rowGroup: typeof r.rowGroup === 'string' ? r.rowGroup : null,
      rowId: typeof r.rowId === 'string' ? r.rowId : null,
      firstSeen: String(r.firstSeen ?? ''),
    }));
  const truncated = rows.length > READ_CAP;
  const kept = rows.slice(0, READ_CAP);
  const latest = [...kept].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, LATEST_SHOWN);
  return { total: kept.length, truncated, latest };
}
