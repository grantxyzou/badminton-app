/**
 * THE ROSTER — who is in a group, as Member docs.
 *
 * `members` is PERSON-scoped (one account, many groups), so "the club's
 * members" is not a query on it. With groups on, the roster is the group's
 * ACTIVE memberships joined to their Member docs by id; with the flag off it
 * is every active Member, which is what BPM's roster has always been. Every
 * club AGGREGATE over a PERSON container (bands, gear, the level fold's
 * self-seeds) narrows to `rosterMemberIds()` first — the rule
 * `lib/groupScope.ts` states and this file makes callable.
 *
 * Names: with groups on, the name a person is known by IN THIS GROUP is the
 * membership's roster name, not `Member.name` (their default display name).
 * `rosterMembers` overlays it so the roster reads the way the group knows
 * its people.
 */
import { randomBytes } from 'crypto';
import { getContainer } from './cosmos';
import { isFlagOn } from './flags';
import { listMemberships, addMembership, rosterNameHolder, releaseRosterName, readMembership, RosterNameTakenError } from './groups';
import { BPM_GROUP_ID } from './groupScope';
import type { Member, Membership } from './types';

const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

/**
 * Does this person string for THIS club? (docs/plans/roles-v2.md, PR 2.)
 *
 * The membership's switch, with one tolerance: a BPM row that has never been
 * set reads the Member's value, because `Member.canString` IS BPM's flag-off
 * value and the stringers it names were granted before the field moved —
 * without it every one of them would have dropped off the bench on deploy.
 * Another club's unset row is no: a stringer for BPM is not one there until
 * its admin says so. Pure, so the roster overlay and the per-person reads
 * cannot disagree.
 */
export function canStringOf(groupId: string, member: Pick<Member, 'canString'>, membership: Pick<Membership, 'canString'> | undefined): boolean {
  if (!groupsOn() || !membership) return member.canString === true;
  if (typeof membership.canString === 'boolean') return membership.canString;
  return groupId === BPM_GROUP_ID && member.canString === true;
}

async function readMemberById(id: string): Promise<Member | undefined> {
  try {
    const { resource } = await getContainer('members').item(id, id).read<Member>();
    return resource ?? undefined;
  } catch (err) {
    if ((err as { code?: number })?.code === 404) return undefined;
    throw err;
  }
}

/** Whether `memberId` strings for `groupId` — the gate the bench reads. */
export async function canStringIn(groupId: string, memberId: string): Promise<boolean> {
  const member = await readMemberById(memberId);
  if (!member || member.active === false) return false;
  if (!groupsOn()) return member.canString === true;
  const membership = await readMembership(groupId, memberId);
  if (!membership || membership.status !== 'active') return false;
  return canStringOf(groupId, member, membership);
}

/**
 * The person as a stringer of `groupId` — id and the name THIS club knows
 * them by — or null when they are not one. The assign gate re-checks here
 * rather than trusting the picker.
 */
export async function stringerIn(groupId: string, memberId: string): Promise<{ id: string; name: string } | null> {
  const member = await readMemberById(memberId);
  if (!member || member.active === false) return null;
  if (!groupsOn()) return member.canString === true ? { id: member.id, name: member.name } : null;
  const membership = await readMembership(groupId, memberId);
  if (!membership || membership.status !== 'active') return null;
  return canStringOf(groupId, member, membership) ? { id: member.id, name: membership.name } : null;
}

/** Everyone who strings for `groupId`, for the assign picker. Names and ids only. */
export async function listStringers(groupId: string): Promise<Array<{ id: string; name: string }>> {
  if (!groupsOn()) {
    const { resources } = await getContainer('members')
      .items.query<Member>({ query: 'SELECT * FROM c WHERE c.canString = true', parameters: [] })
      .fetchAll();
    /* Re-filtered in JS. The mock store matches on parameter NAMES and this
       query binds none, so `c.canString = true` is invisible to it and every
       member comes back — which would put the whole club in the assign
       picker. Production Cosmos honours the WHERE; the test environment needs
       this line. Same hazard, same shape, as the admin push query. */
    return (resources ?? [])
      .filter((m) => m.canString === true && m.active !== false)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return (await rosterMembers(groupId))
    .filter((e) => e.member.canString === true)
    .map((e) => ({ id: e.member.id, name: e.member.name }));
}

/** One roster line: the person, with the group's name and role for them overlaid. */
export interface RosterEntry {
  member: Member;
  /** Absent with the flag off — BPM's roster predates memberships. */
  membership?: Membership;
}

async function readMembersByIds(ids: string[]): Promise<Map<string, Member>> {
  const out = new Map<string, Member>();
  const container = getContainer('members');
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { resource } = await container.item(id, id).read<Member>();
        if (resource) out.set(id, resource);
      } catch (err) {
        if ((err as { code?: number })?.code !== 404) throw err;
      }
    }),
  );
  return out;
}

/**
 * Every Member on the roster. `includeInactive` admits removed/left
 * memberships (flag on) or `active: false` Members (flag off) — the admin's
 * `?all=true` view. Sorted by the name the group knows them by.
 */
export async function rosterMembers(
  groupId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<RosterEntry[]> {
  if (!groupsOn()) {
    const { resources } = await getContainer('members')
      .items.query<Member>({
        query: opts.includeInactive
          ? 'SELECT * FROM c ORDER BY c.name ASC'
          : 'SELECT * FROM c WHERE c.active = true ORDER BY c.name ASC',
      })
      .fetchAll();
    // Sorted here as well as in SQL: the mock store ignores ORDER BY, and a
    // roster that comes back in insertion order in tests hides an ordering bug.
    return (resources ?? []).map((member) => ({ member })).sort((a, b) => a.member.name.localeCompare(b.member.name));
  }
  const memberships = await listMemberships(groupId, { includeInactive: opts.includeInactive });
  const members = await readMembersByIds(memberships.map((m) => m.memberId));
  const entries: RosterEntry[] = [];
  for (const membership of memberships) {
    const member = members.get(membership.memberId);
    if (!member) continue; // a membership whose person was purged — nothing to show
    // Roster name, per-group role and the per-club gift switch overlay the
    // person's defaults — the roster sheet's checkbox must show what THIS
    // club granted, not what another one did.
    entries.push({
      member: {
        ...member,
        name: membership.name,
        role: membership.role === 'member' ? 'member' : 'admin',
        canGift: membership.canGift === true,
        canString: canStringOf(groupId, member, membership),
      },
      membership,
    });
  }
  return entries.sort((a, b) => a.member.name.localeCompare(b.member.name));
}

/**
 * The roster as a NON-ADMIN sees it: name, active and the picture they chose.
 *
 * `GET /api/members` runs on Home every visit, and for a member it returns
 * only these three fields — but it read every active member's whole document
 * to pick them (performance audit, 2026-10-19). With groups off this reads the
 * three fields alone. `active` is re-checked here because the mock store does
 * not apply the WHERE clause. With groups on it is the full roster, mapped:
 * the names and statuses live on the memberships.
 */
export async function rosterPublicRows(groupId: string): Promise<Array<{ name: string; active: boolean; avatar?: unknown }>> {
  if (!groupsOn()) {
    const { resources } = await getContainer('members')
      .items.query<{ name?: unknown; active?: unknown; avatar?: unknown }>({
        query: 'SELECT c.name, c.active, c.avatar FROM c WHERE c.active = true ORDER BY c.name ASC',
      })
      .fetchAll();
    return (resources ?? [])
      .filter((r) => r && typeof r.name === 'string' && r.active === true)
      .map((r) => ({ name: r.name as string, active: true, avatar: r.avatar }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return (await rosterMembers(groupId)).map((e) => ({
    name: e.member.name,
    active: e.membership ? e.membership.status === 'active' : e.member.active === true,
    avatar: e.member.avatar,
  }));
}

/**
 * AN ADMIN ADDS A NAME TO THIS ROSTER (flag on only; callers keep their
 * flag-off path). One owner for a decision three routes used to make with a
 * GLOBAL name scan — which, with groups on, would refuse a name that is free
 * here because another club has it, or worse, reactivate that club's
 * soft-deleted person and join them (their PIN, gear and kudos) to this one.
 *
 *   name reserved here by someone with an active membership → that person
 *   name reserved here by someone removed / departed          → REJOIN them
 *   name free here                                             → a NEW person
 *
 * Never throws `RosterNameTakenError`: the holder is read first, so the
 * reservation that would have thrown is the one we rejoin.
 */
export async function adminAddToRoster(
  groupId: string,
  name: string,
  createdAt = new Date().toISOString(),
): Promise<{ member: Member; membership: Membership; created: boolean }> {
  const trimmed = name.trim();
  const container = getContainer('members');
  const holderId = await rosterNameHolder(groupId, trimmed);
  if (holderId) {
    const { resource } = await container.item(holderId, holderId).read<Member>();
    if (resource) {
      const member = resource.active === true ? resource : ((await container.items.upsert({ ...resource, active: true })).resource as unknown as Member);
      const membership = await addMembership({ groupId, memberId: holderId, name: trimmed, joinedVia: 'admin', joinedAt: createdAt });
      return { member, membership, created: false };
    }
    // A reservation whose person is gone (purged): free it and fall through.
    await releaseRosterName(groupId, trimmed);
  }
  const fresh: Member = {
    id: randomBytes(12).toString('hex'),
    name: trimmed,
    role: 'member',
    sessionCount: 0,
    active: true,
    createdAt,
  };
  const { resource } = await container.items.create(fresh);
  const member = (resource ?? fresh) as Member;
  const membership = await addMembership({ groupId, memberId: member.id, name: trimmed, joinedVia: 'admin', joinedAt: createdAt });
  return { member, membership, created: true };
}

/**
 * The ids a club aggregate over a PERSON container is allowed to see.
 * Flag off: every active Member. Flag on: the group's active memberships.
 *
 * NOT `rosterMembers().map(id)`, which is what it was. That joins every
 * membership to its Member doc with a POINT READ EACH and then throws all of it
 * away except an id the membership already carried — N Cosmos round-trips per
 * request, on a B1 tier, for three hot callers. Worse, that join RETHROWS
 * anything that is not a 404, so one transient 429 on one member read took the
 * whole aggregate down: `bands` 500s, and inside `fetchSeeds`'s try/catch it
 * degrades to ZERO seeds, so calibration runs silently unanchored instead of
 * reporting a failure — the lying-empty-state shape this repo forbids.
 */
export async function rosterMemberIds(groupId: string): Promise<Set<string>> {
  if (!groupsOn()) return new Set((await rosterMembers(groupId)).map((e) => e.member.id));
  return new Set((await listMemberships(groupId)).map((m) => m.memberId));
}

/** The longest roster name an admin may give (the Roster sheet's own limit). */
export const ROSTER_NAME_MAX = 50;

/**
 * What adding one name to this roster did. `exists` is someone already ACTIVE
 * under that name here (with their id, so a caller can mark them); `taken` is
 * a lost race for the reservation between the read and the write.
 */
export type AddRosterNameResult =
  | { outcome: 'added' | 'rejoined'; member: Member }
  | { outcome: 'exists'; memberId: string }
  | { outcome: 'taken' };

/**
 * AN ADMIN ADDS ONE NAME — the one decision `POST /api/members` and the
 * roster import (`POST /api/members/import`) both make, so the add sheet and
 * an imported list cannot disagree about what a name means here. The name is
 * assumed trimmed, non-empty and at most `ROSTER_NAME_MAX`; the callers
 * validate it because each words the refusal its own way.
 *
 * Groups on: an active holder of the name is `exists`; otherwise
 * `adminAddToRoster` rejoins a removed holder or creates a new person.
 * Groups off: the `members` scan BPM always used — an inactive match is
 * reactivated, an active one is `exists`.
 */
export async function addRosterName(groupId: string, name: string): Promise<AddRosterNameResult> {
  if (groupsOn()) {
    const holderId = await rosterNameHolder(groupId, name);
    if (holderId) {
      const holding = await readMembership(groupId, holderId);
      if (holding?.status === 'active') return { outcome: 'exists', memberId: holderId };
    }
    try {
      const { member, created } = await adminAddToRoster(groupId, name);
      return { outcome: created ? 'added' : 'rejoined', member };
    } catch (err) {
      // THE LOST RACE: two admins adding the same name at once, one of them
      // loses `reserveRosterName` between the holder read and the create.
      if (err instanceof RosterNameTakenError) return { outcome: 'taken' };
      throw err;
    }
  }

  const container = getContainer('members');
  const { resources: existing } = await container.items
    .query<Member>({
      query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  // Re-checked in JS: the mock applies one filter per parameter name and
  // would hand back every member if the name ever stopped matching.
  const same = (existing ?? []).filter((m) => typeof m.name === 'string' && m.name.trim().toLowerCase() === name.toLowerCase());
  const live = same.find((m) => m.active !== false);
  if (live) return { outcome: 'exists', memberId: live.id };
  const inactive = same[0];
  if (inactive) {
    const { resource } = await container.items.upsert({ ...inactive, active: true });
    return { outcome: 'rejoined', member: (resource ?? { ...inactive, active: true }) as unknown as Member };
  }
  const fresh: Member = {
    id: randomBytes(12).toString('hex'),
    name,
    role: 'member',
    sessionCount: 0,
    createdAt: new Date().toISOString(),
    active: true,
  };
  const { resource } = await container.items.create(fresh);
  return { outcome: 'added', member: (resource ?? fresh) as Member };
}
