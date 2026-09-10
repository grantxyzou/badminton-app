import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { GROUP_SCOPED, PERSON_SCOPED, GLOBAL } from '@/lib/groupScope';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';
import { containersReferencedInSource, containerReferences } from './containerScan';

/**
 * THE GATE. Raw `getContainer('<group-scoped>')` anywhere in app/ or lib/
 * outside the allowlist is a build error, so a new route cannot quietly add
 * a raw read.
 *
 * During the Phase 1 sweep this was a RATCHET: a `MIGRATION_BACKLOG` of
 * (file, container) pairs still read raw, which could only shrink. Phase 1b
 * (2026-09-09) emptied it and the list was deleted rather than kept at `{}`
 * — an empty backlog made half the assertion unable to fail. If a container
 * is ever re-scoped from PERSON/GLOBAL to GROUP, re-add a backlog keyed per
 * PAIR (a file-level entry would let a swept file add a raw read of a
 * different container and stay green) and shrink it to nothing again.
 *
 * A test rather than an ESLint rule on purpose: a second `no-restricted-syntax`
 * block for the same files silently replaces the design-token rules
 * (CLAUDE.md documents the trap).
 */
const RAW_ACCESS_ALLOWLIST = new Set([
  'lib/groupScope.ts', // the accessor itself
  'lib/cosmos.ts', // the pointer helpers and dev seeds
  'lib/memberPurge.ts', // account deletion spans every group by design (person-level)
  // The person-side view of memberships ("which clubs am I in?") is cross-group
  // by definition. ONE raw read; `groups-lib.test.ts` pins the count at one.
  'lib/groups.ts',
]);

/**
 * THE CANARY THAT STOPS A CONTAINER SLIPPING BETWEEN GROUPS UNCLASSIFIED.
 *
 * Same shape as `member-purge-coverage.test.ts`, for the same reason: a table
 * is only as good as the day it was written, and the next person to add a
 * container will not think about tenancy. A container that nobody decided is
 * GROUP / PERSON / GLOBAL is one whose rows every group can read.
 *
 * Source scan, not runtime, on purpose (see the purge canary's docstring);
 * the scanner itself is shared with that canary in `containerScan.ts`.
 */
const lists: [string, string[]][] = [
  ['GROUP_SCOPED', Object.keys(GROUP_SCOPED)],
  ['PERSON_SCOPED', Object.keys(PERSON_SCOPED)],
  ['GLOBAL', Object.keys(GLOBAL)],
];

describe('group scoping classifies every container', () => {
  it('classifies every container the app touches', () => {
    const referenced = containersReferencedInSource(join(__dirname, '..'));
    expect(referenced.size).toBeGreaterThan(10);
    const classified = new Set(lists.flatMap(([, names]) => names));
    const unclassified = [...referenced].filter((c) => !classified.has(c)).sort();
    expect(
      unclassified,
      `Unclassified container(s): ${unclassified.join(', ')}.\n` +
        'Add each to one of the three tables in lib/groupScope.ts: GROUP_SCOPED ' +
        '(filtered by groupId on every read, stamped on every write), PERSON_SCOPED ' +
        '(keyed by the person; never filtered by group), or GLOBAL (one copy for the ' +
        'whole deployment). A container nobody classified is one every group can read.',
    ).toEqual([]);
  });

  // "Never classifies one container two ways" used to be an assertion here.
  // Since the three tables became views of `CONTAINERS[name].scope` (one field,
  // one value) it could no longer fail, and a check that cannot fail is a claim
  // the type system already makes. Deleted rather than kept as ceremony.

  it('agrees with lib/memberPurge.ts about which containers exist', () => {
    // Two authoritative lists of the same thing drift apart; pin them together.
    const purge = new Set([
      ...OWNED_CONTAINERS,
      ...Object.keys(NOT_MEMBER_SCOPED),
      ...Object.keys(CLASSIFIED_ELSEWHERE),
    ]);
    const scope = new Set(lists.flatMap(([, names]) => names));
    expect([...scope].filter((c) => !purge.has(c)).sort(), 'in groupScope but not memberPurge').toEqual([]);
    expect([...purge].filter((c) => !scope.has(c)).sort(), 'in memberPurge but not groupScope').toEqual([]);
  });

  it('gives every container a stated reason', () => {
    for (const table of [GROUP_SCOPED, PERSON_SCOPED, GLOBAL]) {
      for (const [container, reason] of Object.entries(table)) {
        expect(reason.length, `${container} needs a real reason`).toBeGreaterThan(15);
      }
    }
  });

  it('allows no raw access to a GROUP_SCOPED container outside the allowlist', () => {
    const { gotten } = containerReferences(join(__dirname, '..'));
    const raw: string[] = [];
    for (const name of Object.keys(GROUP_SCOPED)) {
      for (const file of gotten.get(name) ?? []) {
        if (!RAW_ACCESS_ALLOWLIST.has(file)) raw.push(`${file} → ${name}`);
      }
    }
    expect(
      raw.sort(),
      'These reads of a GROUP_SCOPED container go through raw getContainer(). Route them ' +
        'through groupScope(groupId) from lib/groupScope.ts. (Adding the file to ' +
        'RAW_ACCESS_ALLOWLIST is not the fix.)',
    ).toEqual([]);
  });

  it('pins the decisions most likely to be second-guessed', () => {
    // A session belongs to a club; a person's gear bag does not; the catalog is
    // one copy for everybody. If any of these move, the data model changed.
    expect(GROUP_SCOPED.sessions).toBeDefined();
    expect(GROUP_SCOPED.kudos).toBeDefined();
    expect(GROUP_SCOPED.events).toBeDefined();
    expect(PERSON_SCOPED.members).toBeDefined();
    expect(PERSON_SCOPED.playerGear).toBeDefined();
    expect(PERSON_SCOPED.identities).toBeDefined();
    expect(GLOBAL.equipmentCatalog).toBeDefined();
    // Phase 2: a membership is one person's role IN ONE GROUP (the group is its
    // partition); the group registry itself is inside no group.
    expect(GROUP_SCOPED.memberships).toBeDefined();
    expect(GLOBAL.groups).toBeDefined();
  });
});
