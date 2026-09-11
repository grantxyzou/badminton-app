/**
 * THE BACKFILL — turning the one club in production into group #1.
 *
 * `docs/plans/multi-group.md`, Phase 2. Three things, in order, each
 * idempotent so the run can be repeated until the status read shows zeros:
 *
 *   1. `groups/bpm` — created from the admin's own settings (skipDates,
 *      eTransferRecipient move onto `groups.settings`; the Member fields stay
 *      for rollback). Owner: the first `ADMIN_NAMES` name, else the earliest
 *      active admin, else the earliest active member.
 *   2. A membership + name reservation per Member. Active → `active` with the
 *      name reserved; `active: false` → `removed`, no reservation, so the name
 *      is free the way `POST /api/members`' reactivate path already treats
 *      it. Two ACTIVE members sharing a name is a COLLISION: reported, the
 *      second gets no membership, nothing throws — the operator resolves it
 *      by hand (rename one) and re-runs.
 *   3. `groupId: 'bpm'` stamped on every unstamped row of every GROUP_SCOPED
 *      container, under `IfMatch` so a row edited between the read and the
 *      write is skipped and counted, never overwritten. Reported per container.
 *
 * BOUNDED, BECAUSE A REQUEST IS BOUNDED. `events` is append-only, one document
 * per engagement interaction, so it is the container with no ceiling — and
 * Azure App Service kills a request at 230s, which would hand the operator a
 * 504 with no summary and no idea how far the run got. So every scan takes a
 * cap and every run takes a `limit` of rows PER CONTAINER, and the summary
 * names the containers that still have more (`remaining`). Idempotence already
 * made "run until the status is all zeros" the procedure; the limit is what
 * makes that literally true rather than aspirational.
 *
 * RAW ACCESS ON PURPOSE. This spans every row of every group container by
 * definition — the rows it stamps are precisely the ones `groupScope()` would
 * read as BPM's under tolerance but which carry no group. `lib/groupBackfill.ts`
 * is on `RAW_ACCESS_ALLOWLIST` in `__tests__/group-scope-coverage.test.ts` for
 * that, the same reason `lib/memberPurge.ts` is. That entry was DEAD when it
 * was written: the container argument here is a parameter, and the scanner
 * resolved only string literals and single-level `const` aliases, so it saw
 * nothing to exempt. The scanner now reports an unresolved dynamic
 * `getContainer(expr)` as raw access of its own, which is what makes the
 * allowlist line mean something — and closes the hole where any file could
 * have evaded the gate by passing a variable.
 *
 * THE MOCK-STORE TRAP, avoided: `SELECT VALUE COUNT(1) … WHERE NOT
 * IS_DEFINED(c.groupId)` would count EVERY row in the mock, which applies no
 * WHERE and only filters by parameter name — so the status read fetches rows
 * and counts the unstamped ones in JS. Production does the same arithmetic on
 * the projected rows; the difference is only where the filter runs. The mock
 * ignores `OFFSET … LIMIT` for the same reason, so the cap is applied in JS
 * too rather than trusted to the query.
 */
import { getContainer } from './cosmos';
import { CONTAINERS, containersOfScope, pkFieldOf, type ContainerName } from './containers';
import { BPM_GROUP_ID, groupScope } from './groupScope';
import {
  rosterNameKey,
  createGroup,
  readGroup,
  readMembership,
  addMembership,
  reserveRosterName,
  rosterNameHolder,
  removeFromRoster,
  listMemberships,
  updateGroupSettings,
  RosterNameTakenError,
} from './groups';
import { getAdminNames } from './auth';
import type { Member, GroupSettings } from './types';

/** Every group-scoped container whose rows predate the field. `memberships` is born stamped. */
export const STAMPED_CONTAINERS: readonly ContainerName[] = containersOfScope('group').filter((c) => c !== 'memberships');

/**
 * Rows per container, per scan. One request has to finish inside Azure App
 * Service's 230s ceiling, and a stamp is two round trips per row.
 */
export const DEFAULT_SCAN_CAP = 2000;

/**
 * A GLOBAL ceiling on rows stamped per request, and the reason it exists:
 * `DEFAULT_SCAN_CAP` is per CONTAINER, and there are `STAMPED_CONTAINERS.length`
 * of them. A per-container cap does not bound a request — 13 x 2000 is 26,000
 * rows, and at two sequential round trips each that is 52,000 calls inside a
 * window that ends at 230 SECONDS. The cap that was supposed to guarantee a
 * report was the one thing that could not.
 */
export const DEFAULT_ROW_BUDGET = 5000;

/**
 * Stamps in flight at once. The writes are INDEPENDENT — different rows, and a
 * conflict is already reported rather than retried — so the sequential loop was
 * paying full round-trip latency 52,000 times for no ordering it needed. Twelve
 * is deliberately modest: enough to make the budget above comfortable inside the
 * window, small enough that a backfill cannot starve the live app of RUs.
 */
export const STAMP_CONCURRENCY = 12;

/**
 * Stop stamping at this point and report, even with budget left. The belt to
 * the budget's braces: the budget assumes a latency, and this assumes nothing.
 * Whatever Cosmos is doing, the operator gets a summary naming what is left
 * instead of a 504 naming nothing.
 */
export const SOFT_DEADLINE_MS = 150_000;

/** Run `worker` over `items`, at most `n` in flight, preserving no order. */
async function pooled<T>(items: T[], n: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

export interface BackfillStatus {
  group: 'present' | 'absent';
  members: {
    total: number;
    active: number;
    withMembership: number;
    withoutMembership: number;
    /**
     * Members whose `active` flag disagrees with their membership's status.
     * A membership ROW is not the gate — one that says `removed` for a person
     * who was restored flag-off leaves them unresolvable the moment the flag
     * goes on, and `withoutMembership: 0` cannot see it. Re-run to reconcile.
     */
    mismatched: number;
  };
  /**
   * NAMES TWO PEOPLE WANT. A roster name is unique inside a club by
   * construction — the reservation doc's id IS the name, so the second claim
   * 409s on insert, which is what stands in for the unique index Cosmos has
   * not got. That makes a clash impossible to create and therefore invisible
   * until somebody is standing in front of it:
   *
   *   `duplicates`  name groups where two members share the reservation key.
   *                 Both active cannot happen — the reservation forbids it — so
   *                 this is a soft-deleted person and a live one.
   *   `blockedRejoins` the case that actually bites, counted per MEMBER: a
   *                 REMOVED member whose exact name an ACTIVE member now holds.
   *                 Removal releases the name, so it was free to be taken.
   *                 Reactivating them correctly answers 409 rather than
   *                 resurrecting the wrong person — but they cannot come back
   *                 under that name until one of the two is renamed, and
   *                 nothing said so in advance.
   *   `similar`     ADVISORY, and the only one of the three that is not a claim
   *                 about system behaviour: name groups that a person would
   *                 read as one name but the reservation treats as two, because
   *                 punctuation and spacing differ (`Chris L.` vs `chris l`).
   *                 Nothing is blocked and nothing is wrong; it is where a
   *                 double-entered person shows up.
   *
   * THE FIRST TWO USE `rosterNameKey`, THE RESERVATION'S OWN KEY, and must.
   * A first cut folded punctuation away for all three, which broke both ends of
   * the same rule: `Chris L.` and `chris l` reserve DIFFERENT ids, so it
   * reported a rejoin as blocked when it was not, and a CJK name folded to the
   * empty string and was skipped entirely — so a roster where every name is
   * non-Latin reported a serene zero while the backfill itself refused on the
   * collision. A report about a constraint has to be keyed the way the
   * constraint is keyed.
   *
   * ALL THREE ARE KEYED THE WAY THE RESERVATION IS KEYED — by this group's
   * ROSTER name, not by `Member.name`, for anyone who has a membership here.
   * The reservation id carries the group and holds the roster name, so a count
   * taken over every `Member` in the deployment reports clashes that cannot
   * happen (two people called Chris in two different clubs) and misses ones
   * that can (someone this club renamed). See `rosterNamesOf` for the
   * pre-backfill fallback and why it cannot reintroduce that.
   *
   * Counted here rather than in a report nobody opens: this is the number
   * already being read to decide whether the cutover is safe.
   */
  names: { duplicates: number; blockedRejoins: number; similar: number };
  /**
   * Rows carrying no `groupId`, per container. All zeros is the cutover gate,
   * and ZERO IS ALWAYS EXACT — only a large count is capped.
   */
  unstamped: Record<string, number>;
  /** Containers whose count hit `scanCap`: read the number as "at least". */
  truncated: string[];
  scanCap: number;
}

export interface BackfillSummary {
  dryRun: boolean;
  /** `absent` is a FAILURE report: no group, and this run could not make one. */
  group: 'created' | 'exists' | 'would_create' | 'absent';
  ownerMemberId: string | null;
  memberships: {
    created: number;
    existing: number;
    /** First-time memberships for an already soft-deleted Member. */
    removed: number;
    /** Existing `removed` memberships put back, because the Member was restored. */
    rejoined: number;
    /** Existing `active` memberships taken off the roster, because the Member was soft-deleted. */
    deactivated: number;
    collisions: Array<{ name: string; memberIds: string[] }>;
  };
  stamped: Record<string, number>;
  /** Rows whose etag moved between the scan and the write. Re-run to pick them up. */
  conflicts: Record<string, number>;
  /** Rows per container this run was allowed to touch. */
  limit: number;
  /** Rows this run was allowed to stamp in TOTAL, across every container. */
  budget: number;
  /**
   * Why the run stopped short, when it did. `budget` and `deadline` are normal
   * on a large migration and mean "run it again"; only an empty `remaining`
   * with `null` here means the work is done.
   */
  stoppedEarly: 'budget' | 'deadline' | null;
  /** Containers that still hold unstamped rows. Non-empty means: run it again. */
  remaining: string[];
  errors: string[];
}

type Row = Record<string, unknown> & { id: string; _etag?: string; groupId?: unknown };

/**
 * Up to `cap` unstamped rows, plus whether there are more. Reads `cap + 1` so
 * "more" is known without a second query — the same trick a paginated list
 * uses, and the reason no caller needs a `COUNT` the mock cannot honour.
 */
async function unstampedRows(container: ContainerName, cap: number): Promise<{ rows: Row[]; more: boolean }> {
  const pk = pkFieldOf(container);
  // Projected to what the stamp needs (id, key, etag). `birds`, `aliases` and
  // `clubSettings` are partitioned by `/id`, so naming the key unconditionally
  // would emit `SELECT c.id, c.id, …` — a duplicate property Cosmos has no
  // reason to accept, and one the mock could never surface because it ignores
  // projections and hands back whole rows.
  const columns = ['c.id', ...(pk === 'id' ? [] : [`c.${pk}`]), 'c._etag', 'c.groupId'].join(', ');
  const { resources } = await getContainer(container)
    .items.query({
      query: `SELECT ${columns} FROM c WHERE NOT IS_DEFINED(c.groupId) OFFSET 0 LIMIT ${cap + 1}`,
    })
    .fetchAll();
  const all = ((resources ?? []) as Row[]).filter((r) => r.groupId === undefined);
  return { rows: all.slice(0, cap), more: all.length > cap };
}

export async function backfillStatus(opts: { scanCap?: number } = {}): Promise<BackfillStatus> {
  const scanCap = opts.scanCap ?? DEFAULT_SCAN_CAP;
  const [group, members, memberships] = await Promise.all([
    readGroup(BPM_GROUP_ID),
    allMembers(),
    listMemberships(BPM_GROUP_ID, { includeInactive: true }),
  ]);
  const byMember = new Map(memberships.map((m) => [m.memberId, m]));
  const withMembership = new Set(byMember.keys());
  const unstamped: Record<string, number> = {};
  const truncated: string[] = [];
  for (const c of STAMPED_CONTAINERS) {
    const { rows, more } = await unstampedRows(c, scanCap);
    unstamped[c] = rows.length;
    if (more) truncated.push(c);
  }
  return {
    group: group ? 'present' : 'absent',
    members: {
      total: members.length,
      active: members.filter((m) => m.active === true).length,
      withMembership: members.filter((m) => withMembership.has(m.id)).length,
      withoutMembership: members.filter((m) => !withMembership.has(m.id)).length,
      mismatched: members.filter((m) => {
        const ms = byMember.get(m.id);
        return ms !== undefined && (ms.status === 'active') !== (m.active === true);
      }).length,
    },
    names: nameConflicts(rosterNamesOf(members, byMember)),
    unstamped,
    truncated,
    scanCap,
  };
}

/**
 * ADVISORY ONLY — what a PERSON would read as the same name. Folds away
 * punctuation and spacing on top of the reservation key. Never used to claim
 * anything is blocked: the reservation does not fold these together, so they
 * coexist perfectly well.
 */
const looseNameKey = (name: string) => rosterNameKey(name).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * One name as the RESERVATION sees it: the roster name, and whether the
 * membership holding it is live.
 */
interface RosterName {
  name: string;
  active: boolean;
}

/**
 * The names this group's reservations are keyed on — ONE CLUB'S, not the
 * deployment's.
 *
 * This used to run over every `Member` doc in the deployment, which was exactly
 * right while there was one club and silently wrong the moment there were two:
 * `rosterNameKey` would bucket a Chris in club A with a different Chris in club
 * B and call them a within-club duplicate, and a removed Chris here plus an
 * active Chris there would read as a blocked rejoin that nothing blocks. The
 * reservation id is `${groupId}:name:${lower}` — the group is IN the key, so a
 * report about it has to be too.
 *
 * The name comes from the MEMBERSHIP, not from `Member.name`: `Member.name` is
 * the person's default display name and the roster name is what this club calls
 * them, which is the half the reservation actually holds. Status likewise —
 * removal releases the name, and `members.mismatched` exists because the
 * membership and `Member.active` can disagree.
 *
 * A member with NO membership here still counts, under `Member.name` — and
 * that fallback is what keeps the report useful BEFORE the backfill has run,
 * which is the state it is mainly read in. The backfill's own `POST` refuses on
 * two active members sharing a name, so a status read that could not see a
 * clash until after the run would warn nobody in time.
 *
 * THE FALLBACK IS SELF-LIMITING, which is why it does not reopen the bug above.
 * It is populated exactly when no memberships exist yet — and that is the
 * one-club state, where counting every `Member` is correct. Once the backfill
 * has run, `withoutMembership` is 0, the fallback is empty, and only this
 * group's roster names are counted, which is the state a second club can exist
 * in. The gap between them is a person created while the flag was off (which
 * moves `Member.active` and writes no membership) — reported by
 * `withoutMembership` and `mismatched`, and reconciled by a re-run, which is
 * already the operating procedure.
 */
function rosterNamesOf(members: Member[], byMember: Map<string, { name: string; status: string }>): RosterName[] {
  const out: RosterName[] = [];
  for (const m of members) {
    const ms = byMember.get(m.id);
    if (ms) out.push({ name: ms.name || m.name, active: ms.status === 'active' });
    else out.push({ name: m.name, active: m.active === true });
  }
  return out;
}

function groupBy(names: RosterName[], key: (n: RosterName) => string): Map<string, RosterName[]> {
  const out = new Map<string, RosterName[]>();
  for (const n of names) {
    const k = key(n);
    if (!k) continue;
    const held = out.get(k);
    if (held) held.push(n);
    else out.set(k, [n]);
  }
  return out;
}

function nameConflicts(names: RosterName[]): { duplicates: number; blockedRejoins: number; similar: number } {
  // THE RESERVATION'S OWN KEY for anything that claims a behaviour.
  const exact = groupBy(names, (n) => rosterNameKey(n.name));
  let duplicates = 0;
  let blockedRejoins = 0;
  for (const group of exact.values()) {
    if (group.length < 2) continue;
    duplicates += 1;
    // Per MEMBER: one live `Chris` and two removed ones strands TWO people.
    if (group.some((n) => n.active)) {
      blockedRejoins += group.filter((n) => !n.active).length;
    }
  }
  // Advisory: groups a person reads as one name that the reservation does not.
  let similar = 0;
  for (const group of groupBy(names, (n) => looseNameKey(n.name)).values()) {
    if (group.length < 2) continue;
    if (new Set(group.map((n) => rosterNameKey(n.name))).size > 1) similar += 1;
  }
  return { duplicates, blockedRejoins, similar };
}

async function allMembers(): Promise<Member[]> {
  const { resources } = await getContainer('members').items.query<Member>({ query: 'SELECT * FROM c' }).fetchAll();
  return (resources ?? []).filter((m) => typeof m?.id === 'string' && typeof m?.name === 'string');
}

/** The first `ADMIN_NAMES` name that is an active member; else the earliest active admin; else the earliest active member. */
export function chooseOwner(members: Member[]): Member | null {
  const active = members.filter((m) => m.active === true);
  const byCreated = (a: Member, b: Member) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id);
  for (const name of getAdminNames()) {
    const hit = active.find((m) => m.name.trim().toLowerCase() === name);
    if (hit) return hit;
  }
  return active.filter((m) => m.role === 'admin').sort(byCreated)[0] ?? active.sort(byCreated)[0] ?? null;
}

function settingsFrom(owner: Member): Partial<GroupSettings> {
  return {
    ...(Array.isArray(owner.skipDates) ? { skipDates: owner.skipDates } : {}),
    ...(owner.eTransferRecipient ? { eTransferRecipient: owner.eTransferRecipient } : {}),
  };
}

/**
 * One row, and the etag the SCAN handed us is the condition throughout.
 *
 * The re-read is not optional — in Cosmos the scan returns a PROJECTION (id,
 * key, etag), and writing that back would replace the document with four
 * fields. So we re-read the whole thing, and then check TWICE against the
 * scan's etag: once in JS (the row moved while the scan was in flight) and
 * once as `IfMatch` (it moved between this read and this write). Conditioning
 * on the fresh etag instead would make `conflicts` a number that is always
 * zero — correct as a read-modify-write, but it would quietly stamp a row
 * somebody was editing, and it would tell the operator nothing.
 *
 * A row already carrying a group counts as DONE, not as a conflict: that is
 * what a second run of a finished container looks like.
 *
 * `items.upsert` under `IfMatch` rather than `item().replace()` — the general
 * rule (CLAUDE.md) prefers `replace` because an unconditional upsert
 * resurrects a document deleted between the read and the write. A matching
 * etag is what removes that hazard: a deleted document has no etag to match,
 * so the write fails rather than recreating it. It is also the only write the
 * mock enforces the condition on, so this is the shape the tests can hold.
 */
export async function stampRow(container: ContainerName, row: Row): Promise<'stamped' | 'conflict'> {
  const pk = pkFieldOf(container);
  const { resource } = await getContainer(container).item(row.id, String(row[pk])).read();
  if (!resource) return 'conflict'; // deleted since the scan; nothing to stamp
  const full = resource as Row;
  if (full.groupId !== undefined) return 'stamped'; // someone else got here first; counts as done
  if (row._etag && full._etag !== row._etag) return 'conflict'; // edited since the scan
  try {
    await getContainer(container).items.upsert(
      { ...full, groupId: BPM_GROUP_ID },
      full._etag ? { accessCondition: { type: 'IfMatch', condition: full._etag } } : undefined,
    );
    return 'stamped';
  } catch (err) {
    if ((err as { code?: number })?.code === 412) return 'conflict';
    throw err;
  }
}

export async function runBackfill(opts: {
  dryRun: boolean;
  limit?: number;
  budget?: number;
  deadlineMs?: number;
}): Promise<BackfillSummary> {
  const { dryRun } = opts;
  const limit = opts.limit ?? DEFAULT_SCAN_CAP;
  const budget = opts.budget ?? DEFAULT_ROW_BUDGET;
  const deadlineMs = opts.deadlineMs ?? SOFT_DEADLINE_MS;
  const startedAt = Date.now();
  const summary: BackfillSummary = {
    dryRun,
    group: 'exists',
    ownerMemberId: null,
    memberships: { created: 0, existing: 0, removed: 0, rejoined: 0, deactivated: 0, collisions: [] },
    stamped: {},
    conflicts: {},
    limit,
    budget,
    stoppedEarly: null,
    remaining: [],
    errors: [],
  };

  const members = await allMembers();
  const owner = chooseOwner(members);
  summary.ownerMemberId = owner?.id ?? null;

  // 1. The group doc. Every step collects its throws into `summary.errors`
  // rather than letting one escape: the route would answer 500 and the
  // operator would lose the report for work that had already committed.
  let group = await readGroup(BPM_GROUP_ID);
  if (!group) {
    if (!owner) {
      // Not `exists`: there is no group. Saying otherwise reads as success.
      summary.group = 'absent';
      summary.errors.push('no_members: nothing to own the group');
      return summary;
    }
    summary.group = dryRun ? 'would_create' : 'created';
    if (!dryRun) {
      try {
        ({ group } = await createGroup({
          id: BPM_GROUP_ID,
          name: 'BPM Badminton',
          ownerMemberId: owner.id,
          ownerName: owner.name,
          settings: settingsFrom(owner),
          joinedVia: 'backfill',
          createdAt: owner.createdAt,
        }));
      } catch (err) {
        // No group doc means no group to belong to; stop before writing
        // memberships that would point at nothing.
        summary.group = 'absent';
        summary.errors.push(`group: ${(err as Error).message}`);
        return summary;
      }
    }
  } else if (owner && !dryRun) {
    // A re-run after the admin changed a setting on their Member doc before
    // the flag flipped: fill only what the group doc has never had.
    const fill: Partial<GroupSettings> = {};
    if (!group.settings.eTransferRecipient && owner.eTransferRecipient) fill.eTransferRecipient = owner.eTransferRecipient;
    if ((group.settings.skipDates?.length ?? 0) === 0 && (owner.skipDates?.length ?? 0) > 0) fill.skipDates = owner.skipDates;
    if (Object.keys(fill).length > 0) {
      try {
        await updateGroupSettings(BPM_GROUP_ID, fill);
      } catch (err) {
        // Cosmetic next to the stamp: report it and carry on.
        summary.errors.push(`settings: ${(err as Error).message}`);
      }
    }
  }

  // 2. A membership per member. Collisions are reported, never thrown.
  //
  // AND RECONCILED, not just created. The whole backfill window runs FLAG OFF,
  // and with the flag off `POST /api/members` reactivates a soft-deleted person
  // and `DELETE` soft-deletes one without touching memberships at all — that
  // half of the route is gated on the flag. So between two runs a Member's
  // `active` can move out from under the membership this backfill wrote. An
  // earlier cut skipped every row it found, which meant: soft-deleted person
  // gets a `removed` membership, an admin restores them, run 2 reports no work,
  // the flag flips, and that active member has an unreserved name and cannot be
  // resolved at all. The mirror case leaves a departed member holding a live
  // name reservation nobody else can take. Both read GREEN on a status check
  // that only asks whether a membership row exists, which is why
  // `backfillStatus` counts the disagreement too.
  const seen = new Map<string, string>(); // nameLower → memberId that holds it (this run)
  const collide = (key: string, ...memberIds: string[]) => {
    const c = summary.memberships.collisions.find((x) => x.name === key);
    if (c) c.memberIds.push(...memberIds.filter((id) => !c.memberIds.includes(id)));
    else summary.memberships.collisions.push({ name: key, memberIds });
  };
  for (const m of [...members].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))) {
    const key = m.name.trim().toLowerCase();
    const wantActive = m.active === true;
    const roleFor = () => (owner && m.id === owner.id ? 'owner' : m.role === 'admin' ? 'admin' : 'member');
    const existing = await readMembership(BPM_GROUP_ID, m.id);

    if (existing) {
      summary.memberships.existing += 1;
      const isActive = existing.status === 'active';
      if (isActive === wantActive) {
        if (isActive) seen.set(key, m.id);
        continue;
      }
      if (wantActive) {
        // Restored since the last run. `addMembership` is the rejoin path: it
        // reserves the name first, so a name taken in the meantime throws with
        // nothing changed and is reported like any other collision.
        const holder = seen.get(key) ?? (await rosterNameHolder(BPM_GROUP_ID, m.name));
        if (holder && holder !== m.id) {
          collide(key, holder, m.id);
          continue;
        }
        seen.set(key, m.id);
        if (dryRun) {
          summary.memberships.rejoined += 1;
          continue;
        }
        try {
          await addMembership({
            groupId: BPM_GROUP_ID,
            memberId: m.id,
            name: m.name.trim(),
            role: roleFor(),
            joinedVia: 'backfill',
            joinedAt: m.createdAt,
          });
          summary.memberships.rejoined += 1;
        } catch (err) {
          if (err instanceof RosterNameTakenError) collide(key, m.id);
          else summary.errors.push(`membership ${m.id}: ${(err as Error).message}`);
        }
        continue;
      }
      // Soft-deleted since the last run: off the roster, name released.
      if (existing.role === 'owner') {
        // `removeFromRoster` refuses the owner on purpose — a group with no
        // owner is the thing Phase 3's lifecycle API exists to handle. Say so
        // and leave it; this is a person's decision, not a migration's.
        summary.errors.push(`owner ${m.id} is an inactive Member: reassign ownership before the cutover`);
        continue;
      }
      if (dryRun) {
        summary.memberships.deactivated += 1;
        continue;
      }
      try {
        await removeFromRoster(BPM_GROUP_ID, m.id);
        summary.memberships.deactivated += 1;
      } catch (err) {
        summary.errors.push(`membership ${m.id}: ${(err as Error).message}`);
      }
      continue;
    }

    if (!wantActive) {
      if (dryRun) {
        summary.memberships.removed += 1;
        continue;
      }
      try {
        await addRemovedMembership(m);
        summary.memberships.removed += 1;
      } catch (err) {
        summary.errors.push(`membership ${m.id}: ${(err as Error).message}`);
      }
      continue;
    }
    // The reservation lookup runs in a DRY RUN too. It is a point read, and
    // skipping it made the dry run unable to see the one collision that
    // matters most: a reservation left by an interrupted run, with no
    // membership beside it. "Counts what a run would do" has to include that.
    const holder = seen.get(key) ?? (await rosterNameHolder(BPM_GROUP_ID, m.name));
    if (holder && holder !== m.id) {
      collide(key, holder, m.id);
      continue;
    }
    seen.set(key, m.id);
    if (dryRun) {
      summary.memberships.created += 1;
      continue;
    }
    try {
      await addMembership({
        groupId: BPM_GROUP_ID,
        memberId: m.id,
        name: m.name.trim(),
        role: roleFor(),
        joinedVia: 'backfill',
        joinedAt: m.createdAt,
      });
      // Counted AFTER the write. Incrementing first and decrementing only on
      // `RosterNameTakenError` left a transient Cosmos failure reporting a
      // membership that does not exist — and the count is one of the few
      // signals the run gives.
      summary.memberships.created += 1;
    } catch (err) {
      if (err instanceof RosterNameTakenError) collide(key, m.id);
      else summary.errors.push(`membership ${m.id}: ${(err as Error).message}`);
    }
  }

  // 3. The stamp, `limit` rows per container. A container with more left is
  // named in `remaining` — that, and the status read, is what tells the
  // operator to run it again.
  let spent = 0;
  for (const c of STAMPED_CONTAINERS) {
    summary.stamped[c] = 0;
    summary.conflicts[c] = 0;

    // Out of budget or out of time: every container from here on is untouched
    // and therefore unfinished. Name it and keep going through the list, so
    // `remaining` is the WHOLE truth rather than the prefix we got to.
    const exhausted = summary.stoppedEarly !== null || spent >= budget || Date.now() - startedAt > deadlineMs;
    if (exhausted) {
      if (summary.stoppedEarly === null) summary.stoppedEarly = spent >= budget ? 'budget' : 'deadline';
      const { rows } = await unstampedRows(c, 1);
      if (rows.length > 0) summary.remaining.push(c);
      continue;
    }

    // Never scan more than the budget can pay for; `more` stays honest because
    // unstampedRows always reads one past whatever cap it is given.
    const cap = dryRun ? limit : Math.min(limit, budget - spent);
    const { rows, more } = await unstampedRows(c, cap);
    if (more) summary.remaining.push(c);
    if (dryRun) {
      summary.stamped[c] = rows.length;
      continue;
    }

    await pooled(rows, STAMP_CONCURRENCY, async (row) => {
      try {
        const r = await stampRow(c, row);
        if (r === 'stamped') summary.stamped[c] += 1;
        else summary.conflicts[c] += 1;
      } catch (err) {
        summary.errors.push(`${c}/${row.id}: ${(err as Error).message}`);
      }
    });
    spent += rows.length;

    // A conflict is a row this run left behind, so the container is not done
    // even when the scan had nothing beyond the limit.
    if (!more && summary.conflicts[c] > 0) summary.remaining.push(c);
  }

  return summary;
}

/** A soft-deleted person's place on the roster: `removed`, name NOT reserved. */
async function addRemovedMembership(m: Member): Promise<void> {
  // `addMembership` reserves the name, which a removed person must not hold;
  // write the row directly through the accessor's create.
  await groupScope(BPM_GROUP_ID).create('memberships', {
    id: `${BPM_GROUP_ID}:${m.id}`,
    groupId: BPM_GROUP_ID,
    memberId: m.id,
    name: m.name.trim(),
    nameLower: m.name.trim().toLowerCase(),
    role: 'member' as const,
    status: 'removed' as const,
    joinedAt: m.createdAt,
    joinedVia: 'backfill' as const,
  });
}

/** For the tests: the registry's word on what this file touches. */
export const BACKFILL_CONTAINERS = { stamped: STAMPED_CONTAINERS, registry: CONTAINERS } as const;
// `reserveRosterName` is re-exported for the collision test's setup.
export { reserveRosterName };
