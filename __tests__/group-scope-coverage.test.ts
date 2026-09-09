import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { GROUP_SCOPED, PERSON_SCOPED, GLOBAL } from '@/lib/groupScope';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';
import { containersReferencedInSource } from './containerScan';

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
  });
});
