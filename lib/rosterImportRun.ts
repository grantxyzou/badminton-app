/**
 * What an imported list DOES to a roster (docs/plans/roster-import.md).
 * `lib/rosterImport.ts` reads the text in the browser; this decides, on the
 * server, what each name means here — and the dry run and the real run call
 * the same `classifyImport`, so the preview cannot promise something the
 * import then does differently.
 *
 * Keys: `duplicate` and `existing` use `rosterNameKey`, the reservation's own
 * key, because they claim a behaviour; `similar` uses the looser fold and only
 * ever ASKS (CLAUDE.md, the backfill's `names` report learned this the hard
 * way).
 */
import { getContainer } from './cosmos';
import { isFlagOn } from './flags';
import {
  listMemberships,
  rosterNameKey,
  looseNameKey,
  rosterNameHolder,
  readMembership,
  setMembershipRegular,
} from './groups';
import { addRosterName, ROSTER_NAME_MAX } from './roster';
import type { ImportRowInput, ClassifiedRow, ImportOutcome, ImportResultRow } from './rosterImport';

export type { ImportRowInput, ClassifiedRow, ImportKind, ImportOutcome, ImportResultRow } from './rosterImport';

/** Groups off there is no membership to keep a member/drop-in mark on. */
export function importMarksStored(): boolean {
  return groupsOn();
}

const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

/** At most this many rows per call — about five times Six Feathers' roster. */
export const IMPORT_MAX_ROWS = 200;

const tidy = (name: string) => name.replace(/\s+/g, ' ').trim();

interface RosterSnapshot {
  /** Active people by reservation key, with how they are marked. */
  active: Map<string, { memberId: string; name: string; regular: boolean | null }>;
  /** Flag off only: names of inactive Members, who a re-add reactivates. */
  inactive: Set<string>;
}

async function snapshot(groupId: string): Promise<RosterSnapshot> {
  const active = new Map<string, { memberId: string; name: string; regular: boolean | null }>();
  const inactive = new Set<string>();
  if (groupsOn()) {
    for (const m of await listMemberships(groupId)) {
      active.set(m.nameLower, { memberId: m.memberId, name: m.name, regular: typeof m.regular === 'boolean' ? m.regular : null });
    }
    return { active, inactive };
  }
  const { resources } = await getContainer('members')
    .items.query<{ id: string; name?: unknown; active?: unknown }>({ query: 'SELECT c.id, c.name, c.active FROM c' })
    .fetchAll();
  for (const r of resources ?? []) {
    if (typeof r.name !== 'string') continue;
    const key = rosterNameKey(r.name);
    if (r.active === false) inactive.add(key);
    else active.set(key, { memberId: r.id, name: r.name, regular: null });
  }
  return { active, inactive };
}

/** A few point reads at a time, so a 200-row preview does not burst the RU budget. */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function classifyImport(groupId: string, rows: ImportRowInput[]): Promise<ClassifiedRow[]> {
  const roster = await snapshot(groupId);
  const looseRoster = new Map<string, string>();
  for (const p of roster.active.values()) {
    const loose = looseNameKey(p.name);
    if (loose && !looseRoster.has(loose)) looseRoster.set(loose, p.name);
  }

  const seen = new Set<string>();
  const seenLoose = new Map<string, string>();
  const out: ClassifiedRow[] = rows.map((row) => {
    const name = tidy(row.name);
    const regular = row.regular;
    if (!name) return { name, regular, kind: 'invalid', reason: 'empty' };
    if (name.length > ROSTER_NAME_MAX) return { name, regular, kind: 'invalid', reason: 'too_long' };
    const key = rosterNameKey(name);
    if (seen.has(key)) return { name, regular, kind: 'duplicate' };
    seen.add(key);

    const here = roster.active.get(key);
    if (here) {
      // Groups off there is nowhere to keep the mark, so nothing to update.
      const changes = groupsOn() && here.regular !== regular;
      return { name, regular, kind: changes ? 'update' : 'unchanged', current: here.regular };
    }

    const loose = looseNameKey(name);
    const likeRoster = loose ? looseRoster.get(loose) : undefined;
    const likeEarlier = loose ? seenLoose.get(loose) : undefined;
    if (loose && !seenLoose.has(loose)) seenLoose.set(loose, name);
    if (likeRoster || likeEarlier) return { name, regular, kind: 'similar', similarTo: likeRoster ?? likeEarlier };

    return { name, regular, kind: roster.inactive.has(key) ? 'returning' : 'new' };
  });

  if (groupsOn()) {
    // A name reserved here by someone no longer active comes back as that
    // person (`adminAddToRoster` rejoins the holder) — rare, since removing
    // someone releases their name, but it is what the import will do.
    const fresh = out.filter((r) => r.kind === 'new');
    const holders = await inBatches(fresh, 20, (r) => rosterNameHolder(groupId, r.name));
    fresh.forEach((r, i) => {
      if (holders[i]) r.kind = 'returning';
    });
  }
  return out;
}

/**
 * Add, rejoin or mark each row, ONE AT A TIME: two rows of one paste must not
 * race each other for a reservation. A row that throws is reported `failed`
 * and the rest go on — re-running the same paste then picks it up, because
 * every row that landed reads `unchanged` the second time.
 */
export async function runImport(groupId: string, rows: ImportRowInput[]): Promise<ImportResultRow[]> {
  const classified = await classifyImport(groupId, rows);
  const results: ImportResultRow[] = [];
  for (let i = 0; i < classified.length; i++) {
    const row = classified[i];
    const adds = row.kind === 'new' || row.kind === 'returning' || (row.kind === 'similar' && rows[i].force === true);
    try {
      if (adds) {
        const added = await addRosterName(groupId, row.name);
        if (added.outcome === 'added' || added.outcome === 'rejoined') {
          if (groupsOn()) await setMembershipRegular(groupId, added.member.id, row.regular);
          results.push({ name: row.name, outcome: added.outcome });
        } else if (added.outcome === 'exists') {
          // Someone else added them between the preview and now.
          results.push({ name: row.name, outcome: await mark(groupId, added.memberId, row.regular) });
        } else {
          results.push({ name: row.name, outcome: 'taken' });
        }
      } else if (row.kind === 'update') {
        const memberId = await activeHolder(groupId, row.name);
        results.push({ name: row.name, outcome: memberId ? await mark(groupId, memberId, row.regular) : 'failed' });
      } else {
        results.push({ name: row.name, outcome: row.kind === 'unchanged' ? 'unchanged' : 'skipped' });
      }
    } catch (err) {
      console.error('[roster-import] row failed:', err);
      results.push({ name: row.name, outcome: 'failed' });
    }
  }
  return results;
}

async function activeHolder(groupId: string, name: string): Promise<string | null> {
  const holderId = await rosterNameHolder(groupId, name);
  if (!holderId) return null;
  return (await readMembership(groupId, holderId))?.status === 'active' ? holderId : null;
}

async function mark(groupId: string, memberId: string, regular: boolean): Promise<ImportOutcome> {
  if (!groupsOn()) return 'unchanged';
  const before = await readMembership(groupId, memberId);
  if (!before || before.status !== 'active') return 'failed';
  if (before.regular === regular) return 'unchanged';
  return (await setMembershipRegular(groupId, memberId, regular)) ? 'updated' : 'failed';
}
