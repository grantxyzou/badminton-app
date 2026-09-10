/**
 * Groups and memberships — the identity half of multi-group (Phase 2 of
 * `docs/plans/multi-group.md`; shape in the design spec's "groups and
 * memberships" section).
 *
 * ONE ACCOUNT, MANY GROUPS. `Member` stays the person; a `Membership` carries
 * the per-group role and the per-group roster name. Two containers:
 *
 *   `groups`      PK `/id`       GLOBAL — one doc per club. Raw access is
 *                                 allowed for a GLOBAL container.
 *   `memberships` PK `/groupId`  GROUP  — `${groupId}:${memberId}` membership
 *                                 docs AND `${groupId}:name:${nameLower}`
 *                                 reservation docs, in the same partition.
 *
 * ROSTER NAMES ARE UNIQUE PER GROUP, and Cosmos has no unique index, so the
 * reservation doc IS the check — the `identities` pattern: `items.create`
 * refuses a duplicate id with a 409, atomically, and the name is taken exactly
 * when that doc exists. Re-reserving your own name succeeds (the backfill
 * re-runs), and `addMembership` reserves BEFORE it creates so a lost race
 * leaves no half-joined member behind.
 *
 * Every read of `memberships` goes through `groupScope(groupId)` — the
 * accessor derives the partition key from the registry and drops any row
 * outside the group — with ONE exception: `listMembershipsForMember` is the
 * person-side view ("which clubs am I in?") that account deletion and the
 * no-context PIN sign-in need, and it is cross-group by definition. It is the
 * only raw read in this file, `lib/groups.ts` sits on the coverage gate's
 * allowlist for it, and `__tests__/groups-lib.test.ts` pins the count at one.
 */
import { randomBytes } from 'crypto';
import { ensureContainer, getContainer } from './cosmos';
import { groupScope } from './groupScope';
import { defaultMaxPlayers } from './defaults';
import type { Group, GroupSettings, Membership, MembershipRole, NameReservation } from './types';

// ---------------------------------------------------------------------------
// Provisioning — both are new containers, so a route must ensure them before
// first use. Lazy promise, the `app/api/skills/route.ts` pattern; a failure
// clears the memo so the next call retries rather than caching the outage.
// ---------------------------------------------------------------------------

let ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!ready) {
    ready = Promise.all([
      ensureContainer('groups', '/id'),
      ensureContainer('memberships', '/groupId'),
    ])
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** The case-insensitive key a roster name is reserved under. */
export function rosterNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function membershipId(groupId: string, memberId: string): string {
  return `${groupId}:${memberId}`;
}

export function nameReservationId(groupId: string, name: string): string {
  return `${groupId}:name:${rosterNameKey(name)}`;
}

/** A new group's id. Group #1 is `'bpm'`; nothing else is hand-named. */
export function newGroupId(): string {
  return randomBytes(8).toString('hex');
}

export class GroupExistsError extends Error {
  constructor(id: string) {
    super(`group ${id} already exists`);
    this.name = 'GroupExistsError';
  }
}

export class RosterNameTakenError extends Error {
  constructor(groupId: string, name: string) {
    super(`"${name}" is already taken in group ${groupId}`);
    this.name = 'RosterNameTakenError';
  }
}

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;
const isNotFound = (err: unknown) => (err as { code?: number })?.code === 404;

/** A membership row, as opposed to the reservation rows sharing its container. */
const isMembershipRow = (row: unknown) => (row as { kind?: unknown }).kind === undefined;

// ---------------------------------------------------------------------------
// groups (GLOBAL, PK /id)
// ---------------------------------------------------------------------------

export function defaultGroupSettings(): GroupSettings {
  // A group's own value supersedes the deployment default from here on.
  return { skipDates: [], maxPlayers: defaultMaxPlayers() };
}

export async function readGroup(groupId: string): Promise<Group | undefined> {
  await ensureReady();
  try {
    const { resource } = await getContainer('groups').item(groupId, groupId).read();
    return (resource as Group | undefined) ?? undefined;
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

export interface CreateGroupInput {
  /** Omit for a random id. The backfill passes `'bpm'`. */
  id?: string;
  name: string;
  ownerMemberId: string;
  /** The owner's roster name in this group. */
  ownerName: string;
  settings?: Partial<GroupSettings>;
  /** `'create'` for the onboarding door; `'backfill'` for the migration. */
  joinedVia?: Membership['joinedVia'];
  createdAt?: string;
}

/**
 * Create the group doc, then the owner's membership (which reserves their
 * roster name). Throws `GroupExistsError` on a duplicate id — the backfill
 * reads first rather than relying on this.
 */
export async function createGroup(input: CreateGroupInput): Promise<{ group: Group; membership: Membership }> {
  await ensureReady();
  const now = input.createdAt ?? new Date().toISOString();
  const group: Group = {
    id: input.id ?? newGroupId(),
    name: input.name.trim(),
    sport: 'badminton',
    ownerMemberId: input.ownerMemberId,
    createdAt: now,
    createdBy: input.ownerMemberId,
    settings: { ...defaultGroupSettings(), ...input.settings },
  };
  try {
    await getContainer('groups').items.create(group);
  } catch (err) {
    if (isConflict(err)) throw new GroupExistsError(group.id);
    throw err;
  }
  const membership = await addMembership({
    groupId: group.id,
    memberId: input.ownerMemberId,
    name: input.ownerName,
    role: 'owner',
    joinedVia: input.joinedVia ?? 'create',
    joinedAt: now,
  });
  return { group, membership };
}

async function replaceGroup(group: Group): Promise<void> {
  await getContainer('groups').item(group.id, group.id).replace(group);
}

/**
 * Merge a partial into a group's settings. Resolves `undefined` — and writes
 * nothing — when the group does not exist (BPM's doc arrives with the
 * backfill; until then the admin's Member doc is the only copy).
 */
export async function updateGroupSettings(groupId: string, patch: Partial<GroupSettings>): Promise<Group | undefined> {
  const group = await readGroup(groupId);
  if (!group) return undefined;
  const next: Group = { ...group, settings: { ...group.settings, ...patch } };
  await replaceGroup(next);
  return next;
}

// ---------------------------------------------------------------------------
// memberships (GROUP_SCOPED, PK /groupId) — through the accessor
// ---------------------------------------------------------------------------

/**
 * Reserve `name` for `memberId` in `groupId`. `true` when it is theirs now
 * (freshly reserved, or already theirs); `false` when someone else holds it.
 */
export async function reserveRosterName(groupId: string, name: string, memberId: string): Promise<boolean> {
  await ensureReady();
  const scope = groupScope(groupId);
  const doc: NameReservation = {
    id: nameReservationId(groupId, name),
    groupId,
    kind: 'name',
    memberId,
    name: name.trim(),
  };
  // Two attempts: a 409 followed by a read MISS means the holder released the
  // name between the two calls, and one retry of the create closes that gap
  // rather than reporting a free name as taken.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await scope.create('memberships', doc);
      return true;
    } catch (err) {
      if (!isConflict(err)) throw err;
      const held = await scope.read<NameReservation>('memberships', doc.id, groupId);
      if (held) return held.memberId === memberId;
    }
  }
  return false;
}

/**
 * Who holds `name` in `groupId` — the reservation's member id, whatever the
 * state of their membership. `null` when the name is free. The check a WRITE
 * makes before creating a person under a name (`resolveActiveMemberId` is the
 * read-side answer and ignores a lingering reservation on purpose).
 */
export async function rosterNameHolder(groupId: string, name: string): Promise<string | null> {
  await ensureReady();
  const held = await groupScope(groupId).read<NameReservation>('memberships', nameReservationId(groupId, name), groupId);
  return held && held.kind === 'name' ? held.memberId : null;
}

/**
 * Rename one person IN ONE GROUP: reserve the new name (throws
 * `RosterNameTakenError` if someone else holds it here), move the membership,
 * release the old reservation. Resolves `undefined` with nothing written when
 * they have no membership here. A no-op rename (case only) still updates the
 * display case.
 */
export async function renameRosterMember(groupId: string, memberId: string, newName: string): Promise<Membership | undefined> {
  await ensureReady();
  const m = await readMembership(groupId, memberId);
  if (!m) return undefined;
  const name = newName.trim();
  if (!(await reserveRosterName(groupId, name, memberId))) throw new RosterNameTakenError(groupId, name);
  const next = await groupScope(groupId).replace('memberships', { ...m, name, nameLower: rosterNameKey(name) }, groupId);
  if (rosterNameKey(name) !== m.nameLower) await releaseRosterName(groupId, m.name);
  return next;
}

/**
 * Take one person off one roster: status `removed`, and their name released
 * so someone else here can use it (a rejoin reserves it again). The owner
 * cannot be removed this way — hand the group on first (`reassignOwnership`).
 */
export async function removeFromRoster(groupId: string, memberId: string): Promise<Membership | undefined> {
  await ensureReady();
  const m = await readMembership(groupId, memberId);
  if (!m || m.role === 'owner') return undefined;
  if (m.status === 'removed') return m;
  const next = await groupScope(groupId).replace('memberships', { ...m, status: 'removed' as const }, groupId);
  if ((await rosterNameHolder(groupId, m.name)) === memberId) await releaseRosterName(groupId, m.name);
  return next;
}

/** Free a name in one group. Leaves the same name in every other group alone. */
export async function releaseRosterName(groupId: string, name: string): Promise<void> {
  await ensureReady();
  await groupScope(groupId).remove('memberships', nameReservationId(groupId, name), groupId);
}

export interface AddMembershipInput {
  groupId: string;
  memberId: string;
  name: string;
  role?: MembershipRole;
  joinedVia: Membership['joinedVia'];
  joinedAt?: string;
}

/**
 * Join a person to a group under a roster name. Idempotent for someone
 * ACTIVELY in: their existing row comes back UNCHANGED (a re-run must not
 * clobber a role change). Someone who left or was removed REJOINS: a fresh
 * role, a fresh `joinedAt`, and the name reserved again — their old one may
 * belong to somebody else by now. Either way the name is reserved before the
 * row is written, so a taken name throws `RosterNameTakenError` with nothing
 * changed.
 */
export async function addMembership(input: AddMembershipInput): Promise<Membership> {
  await ensureReady();
  const { groupId, memberId } = input;
  const scope = groupScope(groupId);
  const existing = await readMembership(groupId, memberId);
  if (existing?.status === 'active') return existing;

  const name = input.name.trim();
  if (!(await reserveRosterName(groupId, name, memberId))) {
    throw new RosterNameTakenError(groupId, name);
  }
  if (existing) {
    const revived: Membership = {
      ...existing,
      name,
      nameLower: rosterNameKey(name),
      role: input.role ?? 'member',
      status: 'active',
      joinedAt: input.joinedAt ?? new Date().toISOString(),
      joinedVia: input.joinedVia,
    };
    const written = await scope.replace('memberships', revived, groupId);
    if (written) return written;
    // Gone between the read and the replace; fall through and create it.
  }
  const doc: Membership = {
    id: membershipId(groupId, memberId),
    groupId,
    memberId,
    name,
    nameLower: rosterNameKey(name),
    role: input.role ?? 'member',
    status: 'active',
    joinedAt: input.joinedAt ?? new Date().toISOString(),
    joinedVia: input.joinedVia,
  };
  try {
    return await scope.create('memberships', doc);
  } catch (err) {
    if (!isConflict(err)) throw err;
    // Lost a race with a concurrent join by the same person: theirs stands.
    const winner = await readMembership(groupId, memberId);
    if (winner) {
      if (winner.nameLower !== doc.nameLower) await releaseRosterName(groupId, name);
      return winner;
    }
    throw err;
  }
}

/** Point read. A row of another group reads as absent, silently (the accessor's contract). */
export async function readMembership(groupId: string, memberId: string): Promise<Membership | undefined> {
  await ensureReady();
  const row = await groupScope(groupId).read<Membership>('memberships', membershipId(groupId, memberId), groupId);
  return row && isMembershipRow(row) ? row : undefined;
}

/**
 * The roster: one group's memberships, active only unless asked. Reservation
 * rows share the partition and are excluded in SQL AND re-checked in JS (the
 * mock applies no WHERE).
 */
export async function listMemberships(
  groupId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Membership[]> {
  await ensureReady();
  const rows = await groupScope(groupId).query<Membership>('memberships', { where: 'NOT IS_DEFINED(c.kind)' });
  return rows.filter((r) => isMembershipRow(r) && (opts.includeInactive || r.status === 'active'));
}

/**
 * Every ACTIVE membership holding one roster name, in any group. The SECOND
 * (and last) cross-group raw read in this file, and it exists for exactly one
 * caller: signing in by name and PIN with no group context, where the whole
 * question is "how many people could this be?".
 *
 * `groupScope()` cannot express it — the accessor's entire job is to pin a
 * query to one group, and this one deliberately spans them. It lives here, not
 * at the call site, so the raw-access gate keeps holding the line;
 * `groups-lib.test.ts` pins the count of raw reads in this file, so a third
 * one has to be argued for rather than added.
 *
 * The `nameLower` equality is re-checked in JS on every row. The mock filters
 * by PARAMETER NAME and an unrecognised one applies NO filter, so a typo here
 * would hand a sign-in every membership row in every group as a candidate —
 * the mock's destructive direction, and this is a credential path.
 */
export async function findMembershipsByRosterName(name: string): Promise<Membership[]> {
  await ensureReady();
  const key = rosterNameKey(name);
  const { resources } = await getContainer('memberships')
    .items.query({
      query: 'SELECT * FROM c WHERE c.nameLower = @name AND c.status = @status AND NOT IS_DEFINED(c.kind)',
      parameters: [
        { name: '@name', value: key },
        { name: '@status', value: 'active' },
      ],
    })
    .fetchAll();
  return ((resources ?? []) as Membership[]).filter(
    (r) => isMembershipRow(r) && r.nameLower === key && r.status === 'active',
  );
}

/**
 * THE PERSON-SIDE CROSS-GROUP READ: every membership a person holds, in every
 * group. Raw access on purpose — the person-side view cannot go through a
 * scope that exists to exclude other groups. Bound to `@memberId` (a name the
 * mock filters on) and re-checked in JS; reservation rows carry a `memberId`
 * too and are dropped.
 */
export async function listMembershipsForMember(memberId: string): Promise<Membership[]> {
  await ensureReady();
  const { resources } = await getContainer('memberships')
    .items.query({
      query: 'SELECT * FROM c WHERE c.memberId = @memberId AND NOT IS_DEFINED(c.kind)',
      parameters: [{ name: '@memberId', value: memberId }],
    })
    .fetchAll();
  return ((resources ?? []) as Membership[]).filter((r) => r.memberId === memberId && isMembershipRow(r));
}

/** Owner or admin of a group — the roles that mint an `admin_session` there. */
export const GROUP_ADMIN_ROLES: ReadonlySet<MembershipRole> = new Set<MembershipRole>(['owner', 'admin']);

/**
 * THE ONE definition of "is an admin of this group": an ACTIVE membership
 * whose role is owner or admin. `lib/auth.ts`, `lib/authSession.ts` and the
 * admin login route all call this rather than restating it — a rule added to
 * a shared function is worthless if a caller reimplemented it.
 */
export function isGroupAdminMembership(m: Membership | undefined): m is Membership {
  return !!m && m.status === 'active' && GROUP_ADMIN_ROLES.has(m.role);
}

/** The membership if it admits `memberId` as an admin of `groupId`, else undefined. */
export async function readGroupAdmin(groupId: string, memberId: string): Promise<Membership | undefined> {
  const m = await readMembership(groupId, memberId);
  return isGroupAdminMembership(m) ? m : undefined;
}

/**
 * Change one person's role in one group. `owner` is not assignable here —
 * ownership moves only through `reassignOwnership`, so a group can never have
 * two owners or none. Resolves `undefined` when there is no active
 * membership to change.
 */
export async function setMembershipRole(
  groupId: string,
  memberId: string,
  role: Exclude<MembershipRole, 'owner'>,
): Promise<Membership | undefined> {
  await ensureReady();
  const m = await readMembership(groupId, memberId);
  if (!m || m.status !== 'active' || m.role === 'owner') return undefined;
  if (m.role === role) return m;
  return groupScope(groupId).replace('memberships', { ...m, role }, groupId);
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

export type ReassignResult =
  | { outcome: 'reassigned'; to: string }
  | { outcome: 'closed' }
  | { outcome: 'not_owner' };

/**
 * Hand a group to someone else when its owner leaves or deletes their account
 * (App Store 5.1.1(v) deletion must never block on "but you own a group").
 * Longest-standing active admin, else longest-standing active member, else —
 * nobody left — the group is CLOSED: `closedAt` stamped, the doc kept.
 *
 * Kept, not deleted, because the group doc is what resolves a `groupId`. Its
 * sessions, players, settings and the rest sit in a dozen GROUP_SCOPED
 * containers carrying that id, and removing the one doc would orphan them all
 * where no route or admin tool could reach them again. Sweeping those rows is
 * a group-lifecycle operation (Phase 3), not a side effect of one person
 * deleting their account.
 *
 * WRITE ORDER: the group doc first. It is the source of truth `readGroup`
 * answers from, so a failure after it leaves a state a retry converges on
 * (the old owner is no longer named, and the heir's role is repaired below on
 * the next call). The membership `role: 'owner'` is a mirror of
 * `ownerMemberId`, never the other way round. The old owner's row, if it
 * still exists, becomes `admin`; the purge deletes it afterwards anyway.
 */
export async function reassignOwnership(groupId: string, fromMemberId: string): Promise<ReassignResult> {
  await ensureReady();
  const group = await readGroup(groupId);
  if (!group || group.ownerMemberId !== fromMemberId) return { outcome: 'not_owner' };

  const scope = groupScope(groupId);
  const roster = (await listMemberships(groupId)).filter((m) => m.memberId !== fromMemberId);
  const byTenure = (a: Membership, b: Membership) =>
    (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '') || a.memberId.localeCompare(b.memberId);
  const heir =
    roster.filter((m) => m.role === 'admin').sort(byTenure)[0] ??
    roster.filter((m) => m.role === 'member').sort(byTenure)[0];

  if (!heir) {
    await replaceGroup({ ...group, closedAt: new Date().toISOString() });
    return { outcome: 'closed' };
  }

  await replaceGroup({ ...group, ownerMemberId: heir.memberId });
  await scope.replace('memberships', { ...heir, role: 'owner' }, groupId);
  const old = await readMembership(groupId, fromMemberId);
  if (old && old.role === 'owner') await scope.replace('memberships', { ...old, role: 'admin' }, groupId);
  return { outcome: 'reassigned', to: heir.memberId };
}
