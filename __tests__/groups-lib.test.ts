import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetMockStore, getStore, seedDoc, seedGroup, seedMembership } from './helpers';
import {
  createGroup,
  readGroup,
  addMembership,
  reserveRosterName,
  releaseRosterName,
  readMembership,
  listMemberships,
  listMembershipsForMember,
  reassignOwnership,
  setMembershipRole,
  membershipId,
  nameReservationId,
  rosterNameKey,
  GroupExistsError,
  RosterNameTakenError,
} from '@/lib/groups';
import { purgeMember } from '@/lib/memberPurge';
import { CONTAINERS, PROVISIONED_CONTAINERS } from '@/lib/containers';

/**
 * PHASE 2, PR 1: the two identity containers and their purge rows.
 *
 * `groups` (PK `/id`, GLOBAL) holds one doc per club. `memberships` (PK
 * `/groupId`, GROUP_SCOPED) holds a person's per-group role AND the name
 * reservation that makes roster names unique per group — the `identities`
 * pattern: the reservation doc IS the uniqueness check, because Cosmos has no
 * unique index and `items.create` 409s a duplicate id atomically.
 *
 * Every read of `memberships` here goes through `groupScope(groupId)` except
 * the ONE deliberately cross-group read, `listMembershipsForMember` — the
 * person-side view ("which clubs am I in?") that account deletion and the
 * no-context PIN sign-in need. The last test pins that it stays the only one.
 */
beforeEach(() => {
  resetMockStore();
});

describe('registry', () => {
  it('registers both containers with the keys the design fixes', () => {
    expect(CONTAINERS.groups).toMatchObject({ pk: '/id', scope: 'global', provisioned: false });
    expect(CONTAINERS.memberships).toMatchObject({ pk: '/groupId', scope: 'group', provisioned: false });
    // Neither is provisioned: both are ensured lazily on first touch (an account
    // deletion is a touch). A claim about production, so it must not drift
    // because a test wanted it to.
    expect(PROVISIONED_CONTAINERS).not.toContain('groups');
    expect(PROVISIONED_CONTAINERS).not.toContain('memberships');
  });
});

describe('ids', () => {
  it('shapes the three ids the spec fixes', () => {
    expect(membershipId('bpm', 'm1')).toBe('bpm:m1');
    expect(nameReservationId('bpm', '  Lin ')).toBe('bpm:name:lin');
    expect(rosterNameKey('  Lin DAN ')).toBe('lin dan');
  });
});

describe('createGroup', () => {
  it('creates the group doc, the owner membership and the owner’s name reservation', async () => {
    const { group, membership } = await createGroup({
      id: 'club-a',
      name: 'Club A',
      ownerMemberId: 'm-owner',
      ownerName: 'Owner',
    });
    expect(group).toMatchObject({ id: 'club-a', name: 'Club A', sport: 'badminton', ownerMemberId: 'm-owner', createdBy: 'm-owner' });
    expect(group.settings).toMatchObject({ skipDates: [], maxPlayers: 12 });
    expect(membership).toMatchObject({ id: 'club-a:m-owner', groupId: 'club-a', memberId: 'm-owner', role: 'owner', status: 'active', joinedVia: 'create', name: 'Owner', nameLower: 'owner' });
    expect(await readGroup('club-a')).toMatchObject({ id: 'club-a' });
    const reservation = getStore()['memberships'].find((r) => (r as { id: string }).id === 'club-a:name:owner');
    expect(reservation).toMatchObject({ groupId: 'club-a', kind: 'name', memberId: 'm-owner' });
  });

  it('mints a random hex id when none is given, and refuses a duplicate', async () => {
    const { group } = await createGroup({ name: 'X', ownerMemberId: 'm1', ownerName: 'A' });
    expect(group.id).toMatch(/^[0-9a-f]{16}$/);
    await expect(createGroup({ id: group.id, name: 'X', ownerMemberId: 'm2', ownerName: 'B' })).rejects.toBeInstanceOf(GroupExistsError);
  });

  it('reads absent for an unknown group', async () => {
    expect(await readGroup('nope')).toBeUndefined();
  });
});

describe('roster names', () => {
  it('are unique per group, case-insensitively, and free in another group', async () => {
    expect(await reserveRosterName('g1', 'Lin', 'm1')).toBe(true);
    expect(await reserveRosterName('g1', ' lin ', 'm2')).toBe(false);
    expect(await reserveRosterName('g2', 'Lin', 'm2')).toBe(true);
  });

  it('re-reserving your own name is idempotent (the backfill re-runs)', async () => {
    expect(await reserveRosterName('g1', 'Lin', 'm1')).toBe(true);
    expect(await reserveRosterName('g1', 'Lin', 'm1')).toBe(true);
  });

  it('release frees the name, and only this group’s copy', async () => {
    await reserveRosterName('g1', 'Lin', 'm1');
    await reserveRosterName('g2', 'Lin', 'm1');
    await releaseRosterName('g1', 'Lin');
    expect(await reserveRosterName('g1', 'Lin', 'm9')).toBe(true);
    expect(await reserveRosterName('g2', 'Lin', 'm9')).toBe(false);
  });
});

describe('addMembership', () => {
  it('stamps the group, reserves the name, defaults role and status', async () => {
    const m = await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    expect(m).toMatchObject({ id: 'g1:m1', groupId: 'g1', role: 'member', status: 'active', nameLower: 'lin' });
    expect(await reserveRosterName('g1', 'lin', 'm2')).toBe(false);
  });

  it('refuses a taken name and leaves nothing behind', async () => {
    await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    await expect(addMembership({ groupId: 'g1', memberId: 'm2', name: 'LIN', joinedVia: 'link' })).rejects.toBeInstanceOf(RosterNameTakenError);
    expect(await readMembership('g1', 'm2')).toBeUndefined();
  });

  it('REJOINS someone who left or was removed: fresh role, fresh joinedAt, name reserved again', async () => {
    seedMembership('g1', 'm1', { name: 'Lin', status: 'left', role: 'admin', joinedAt: '2026-01-01T00:00:00Z', joinedVia: 'create' });
    // Their old name went to someone else while they were away.
    await addMembership({ groupId: 'g1', memberId: 'm2', name: 'Lin', joinedVia: 'link' });
    await expect(addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' })).rejects.toBeInstanceOf(RosterNameTakenError);
    expect((await listMemberships('g1')).map((m) => m.memberId)).toEqual(['m2']);

    const back = await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin Dan', joinedVia: 'link' });
    expect(back).toMatchObject({ id: 'g1:m1', status: 'active', role: 'member', name: 'Lin Dan', nameLower: 'lin dan', joinedVia: 'link' });
    expect(back.joinedAt).not.toBe('2026-01-01T00:00:00Z');
    expect((await listMemberships('g1')).map((m) => m.memberId).sort()).toEqual(['m1', 'm2']);
    expect(getStore()['memberships'].filter((r) => (r as { id: string }).id === 'g1:m1')).toHaveLength(1);
  });

  it('returns the existing membership unchanged when the person is already in', async () => {
    const first = await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', role: 'admin', joinedVia: 'backfill' });
    const again = await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    expect(again.role).toBe('admin');
    expect(again.joinedAt).toBe(first.joinedAt);
    expect(getStore()['memberships'].filter((r) => (r as { id: string }).id === 'g1:m1')).toHaveLength(1);
  });
});

describe('readMembership', () => {
  it('reads a foreign group’s row as absent — silently', async () => {
    seedMembership('other', 'm1', { name: 'Lin' });
    expect(await readMembership('other', 'm1')).toMatchObject({ groupId: 'other' });
    expect(await readMembership('bpm', 'm1')).toBeUndefined();
  });
});

describe('listMemberships (the roster)', () => {
  it('lists one group’s memberships only, never reservations, never another group’s', async () => {
    await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'g1', memberId: 'm2', name: 'Viktor', joinedVia: 'link' });
    await addMembership({ groupId: 'g2', memberId: 'm3', name: 'Kento', joinedVia: 'link' });
    const roster = await listMemberships('g1');
    expect(roster.map((m) => m.memberId).sort()).toEqual(['m1', 'm2']);
    for (const m of roster) expect(m).not.toHaveProperty('kind');
  });

  it('drops removed and left rows unless asked', async () => {
    seedMembership('g1', 'm1', { name: 'A', status: 'active' });
    seedMembership('g1', 'm2', { name: 'B', status: 'removed' });
    seedMembership('g1', 'm3', { name: 'C', status: 'left' });
    expect((await listMemberships('g1')).map((m) => m.memberId)).toEqual(['m1']);
    expect((await listMemberships('g1', { includeInactive: true })).map((m) => m.memberId).sort()).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('listMembershipsForMember (the one cross-group read)', () => {
  it('spans groups and skips reservations', async () => {
    await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'g2', memberId: 'm1', name: 'Lin Dan', joinedVia: 'code' });
    await addMembership({ groupId: 'g2', memberId: 'm2', name: 'Viktor', joinedVia: 'code' });
    const mine = await listMembershipsForMember('m1');
    expect(mine.map((m) => m.groupId).sort()).toEqual(['g1', 'g2']);
    for (const m of mine) expect(m).not.toHaveProperty('kind');
  });

  it('holds lib/groups.ts to exactly TWO raw reads of memberships', () => {
    // `memberships` is GROUP_SCOPED, so lib/groups.ts sits on the raw-access
    // allowlist. A file-level allowlist would let a third raw read in
    // unnoticed; this pins the count so each one has to be argued for.
    //
    // The two, and why `groupScope()` cannot express either — the accessor's
    // whole job is to pin a query to ONE group, and both of these deliberately
    // span them:
    //   1. `listMembershipsForMember` — the person-side view, "which clubs am
    //      I in?", which Phase 3's group switcher is built on.
    //   2. `findMembershipsByRosterName` — signing in by name and PIN with no
    //      group context, where the question IS "how many people could this
    //      be?" and the answer decides whether a sign-in is allowed at all.
    const src = readFileSync(join(__dirname, '..', 'lib', 'groups.ts'), 'utf8');
    const raw = src.match(/getContainer\(\s*'memberships'\s*\)/g) ?? [];
    expect(raw).toHaveLength(2);
  });
});

describe('setMembershipRole', () => {
  it('changes an active member’s role, never the owner’s, and nothing for the absent', async () => {
    seedMembership('g1', 'owner', { name: 'O', role: 'owner' });
    seedMembership('g1', 'm1', { name: 'M', role: 'member' });
    seedMembership('g1', 'm2', { name: 'L', role: 'admin', status: 'left' });
    expect((await setMembershipRole('g1', 'm1', 'admin'))?.role).toBe('admin');
    expect((await readMembership('g1', 'm1'))?.role).toBe('admin');
    expect(await setMembershipRole('g1', 'owner', 'member')).toBeUndefined();
    expect((await readMembership('g1', 'owner'))?.role).toBe('owner');
    expect(await setMembershipRole('g1', 'm2', 'member')).toBeUndefined();
    expect(await setMembershipRole('g1', 'nobody', 'admin')).toBeUndefined();
  });
});

describe('reassignOwnership', () => {
  it('hands the group to the longest-standing admin', async () => {
    seedGroup('g1', { ownerMemberId: 'owner' });
    seedMembership('g1', 'owner', { name: 'O', role: 'owner', joinedAt: '2026-01-01T00:00:00Z' });
    seedMembership('g1', 'admin-new', { name: 'A2', role: 'admin', joinedAt: '2026-03-01T00:00:00Z' });
    seedMembership('g1', 'admin-old', { name: 'A1', role: 'admin', joinedAt: '2026-02-01T00:00:00Z' });
    seedMembership('g1', 'member-oldest', { name: 'M', role: 'member', joinedAt: '2026-01-02T00:00:00Z' });
    const result = await reassignOwnership('g1', 'owner');
    expect(result).toEqual({ outcome: 'reassigned', to: 'admin-old' });
    expect((await readGroup('g1'))?.ownerMemberId).toBe('admin-old');
    expect((await readMembership('g1', 'admin-old'))?.role).toBe('owner');
    expect((await readMembership('g1', 'owner'))?.role).toBe('admin');
  });

  it('falls back to the longest-standing member when there is no admin', async () => {
    seedGroup('g1', { ownerMemberId: 'owner' });
    seedMembership('g1', 'owner', { name: 'O', role: 'owner' });
    seedMembership('g1', 'm-late', { name: 'L', role: 'member', joinedAt: '2026-05-01T00:00:00Z' });
    seedMembership('g1', 'm-early', { name: 'E', role: 'member', joinedAt: '2026-04-01T00:00:00Z' });
    seedMembership('g1', 'm-gone', { name: 'G', role: 'admin', status: 'removed', joinedAt: '2026-01-01T00:00:00Z' });
    expect(await reassignOwnership('g1', 'owner')).toEqual({ outcome: 'reassigned', to: 'm-early' });
  });

  it('CLOSES the group when nobody is left to own it — the doc stays, so its rows stay resolvable', async () => {
    seedGroup('g1', { ownerMemberId: 'owner' });
    seedMembership('g1', 'owner', { name: 'O', role: 'owner' });
    seedDoc('memberships', { id: nameReservationId('g1', 'Ghost'), groupId: 'g1', kind: 'name', memberId: 'm-left', name: 'Ghost' });
    seedDoc('sessions', { id: 'g1:session-2026-01-08', sessionId: 'g1:session-2026-01-08', groupId: 'g1', datetime: '2026-01-08T19:00:00-08:00' });
    expect(await reassignOwnership('g1', 'owner')).toEqual({ outcome: 'closed' });
    const closed = await readGroup('g1');
    expect(closed?.closedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(closed?.ownerMemberId).toBe('owner');
    // Nothing outside the group doc is touched: a group-lifecycle sweep is
    // Phase 3's. Three rows in g1 — the owner's membership, the owner's own
    // name reservation (`seedMembership` writes it, the way `addMembership`
    // does) and the orphaned Ghost reservation — all of them still there.
    expect(getStore()['sessions']).toHaveLength(1);
    expect(getStore()['memberships'].filter((r) => (r as { groupId: string }).groupId === 'g1')).toHaveLength(3);
  });

  it('writes the group doc BEFORE the membership roles, so a retry converges on it', async () => {
    seedGroup('g1', { ownerMemberId: 'owner' });
    seedMembership('g1', 'owner', { name: 'O', role: 'owner' });
    seedMembership('g1', 'heir', { name: 'H', role: 'admin' });
    await reassignOwnership('g1', 'owner');
    // A second call finds the doc already handed on and does nothing.
    expect(await reassignOwnership('g1', 'owner')).toEqual({ outcome: 'not_owner' });
    expect((await readGroup('g1'))?.ownerMemberId).toBe('heir');
  });

  it('is a no-op for a group the member does not own', async () => {
    seedGroup('g1', { ownerMemberId: 'owner' });
    seedMembership('g1', 'owner', { name: 'O', role: 'owner' });
    seedMembership('g1', 'm1', { name: 'M', role: 'member' });
    expect(await reassignOwnership('g1', 'm1')).toEqual({ outcome: 'not_owner' });
    expect((await readGroup('g1'))?.ownerMemberId).toBe('owner');
  });
});

describe('account deletion', () => {
  it('deletes every membership and name reservation the member holds, in every group', async () => {
    await addMembership({ groupId: 'g1', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'g2', memberId: 'm1', name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'g1', memberId: 'm2', name: 'Viktor', joinedVia: 'link' });
    const summary = await purgeMember('m1', 'Lin');
    expect(summary.failed).toEqual([]);
    const rows = getStore()['memberships'] as { id: string; memberId: string }[];
    expect(rows.filter((r) => r.memberId === 'm1')).toEqual([]);
    expect(rows.map((r) => r.id).sort()).toEqual(['g1:m2', 'g1:name:viktor']);
    // The name is free again.
    expect(await reserveRosterName('g1', 'Lin', 'm9')).toBe(true);
  });

  it('reassigns any group the member owned BEFORE removing them', async () => {
    await createGroup({ id: 'g1', name: 'G', ownerMemberId: 'm1', ownerName: 'Lin' });
    await addMembership({ groupId: 'g1', memberId: 'm2', name: 'Viktor', role: 'admin', joinedVia: 'link' });
    const summary = await purgeMember('m1', 'Lin');
    expect(summary.failed).toEqual([]);
    expect(summary.groupsReassigned).toBe(1);
    expect((await readGroup('g1'))?.ownerMemberId).toBe('m2');
    expect((await readMembership('g1', 'm2'))?.role).toBe('owner');
    expect(await readMembership('g1', 'm1')).toBeUndefined();
  });

  it('closes a group the member alone owned, and still clears their own rows from it', async () => {
    await createGroup({ id: 'solo', name: 'Solo', ownerMemberId: 'm1', ownerName: 'Lin' });
    const summary = await purgeMember('m1', 'Lin');
    expect(summary.groupsClosed).toBe(1);
    expect((await readGroup('solo'))?.closedAt).toBeDefined();
    expect(getStore()['memberships'] ?? []).toEqual([]);
  });
});
