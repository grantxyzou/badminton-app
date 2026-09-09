import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { CONTAINERS, pkOf, pkFieldOf, containersOfScope, PROVISIONED_CONTAINERS } from '@/lib/containers';
import { GROUP_SCOPED, PERSON_SCOPED, GLOBAL } from '@/lib/groupScope';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';
import { containersReferencedInSource } from './containerScan';

/**
 * ONE REGISTRY FOR THE THINGS THAT ARE TRUE OF A CONTAINER.
 *
 * Before this, the container→partition-key mapping lived in four places by
 * hand: memberPurge's `pk` column, the provisioning test's PROVISIONED set,
 * CLAUDE.md's bullet, and every caller of `item(id, pk)`. The mock ignores the
 * PK argument, so a caller passing the wrong one passes CI and 404s in
 * production. The registry is what lets the group accessor derive the key
 * from the container name so a caller cannot get it wrong.
 */
describe('lib/containers registry', () => {
  it('names every container the source touches, and nothing else', () => {
    const referenced = containersReferencedInSource(join(__dirname, '..'));
    expect(referenced.size).toBeGreaterThan(10);
    const registered = new Set(Object.keys(CONTAINERS));
    expect([...referenced].filter((c) => !registered.has(c)).sort(), 'referenced but unregistered').toEqual([]);
    expect([...registered].filter((c) => !referenced.has(c)).sort(), 'registered but unreferenced').toEqual([]);
  });

  it('gives every container a partition-key path and a scope', () => {
    for (const [name, meta] of Object.entries(CONTAINERS)) {
      expect(meta.pk, `${name} pk`).toMatch(/^\/[a-zA-Z]+$/);
      expect(['group', 'person', 'global'], `${name} scope`).toContain(meta.scope);
    }
  });

  it('derives the partition-key FIELD from the path', () => {
    expect(pkOf('players')).toBe('/sessionId');
    expect(pkFieldOf('players')).toBe('sessionId');
    expect(pkOf('kudos')).toBe('/recipientMemberId');
    expect(pkFieldOf('kudos')).toBe('recipientMemberId');
    expect(pkOf('equipmentCatalog')).toBe('/category');
    expect(pkOf('members')).toBe('/id');
  });

  it('is what lib/groupScope.ts derives its three tables from', () => {
    expect(Object.keys(GROUP_SCOPED).sort()).toEqual(containersOfScope('group').sort());
    expect(Object.keys(PERSON_SCOPED).sort()).toEqual(containersOfScope('person').sort());
    expect(Object.keys(GLOBAL).sort()).toEqual(containersOfScope('global').sort());
  });

  it('agrees with lib/memberPurge.ts about which containers exist', () => {
    const purge = [
      ...OWNED_CONTAINERS,
      ...Object.keys(NOT_MEMBER_SCOPED),
      ...Object.keys(CLASSIFIED_ELSEWHERE),
    ].sort();
    expect(purge).toEqual(Object.keys(CONTAINERS).sort());
  });

  it('marks which containers exist in production versus are ensured lazily', () => {
    // Verified against `az cosmosdb sql container list` on 2026-08-28 (the
    // provisioning canary's own list). Adding a name here is a claim about
    // production, not a way to silence that canary.
    expect(PROVISIONED_CONTAINERS).toContain('players');
    expect(PROVISIONED_CONTAINERS).not.toContain('pushSubscriptions');
    expect(PROVISIONED_CONTAINERS).not.toContain('authmigration');
    expect(PROVISIONED_CONTAINERS.length).toBe(21);
  });
});
