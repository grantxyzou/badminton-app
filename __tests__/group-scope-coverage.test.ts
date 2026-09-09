import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { GROUP_SCOPED, PERSON_SCOPED, GLOBAL } from '@/lib/groupScope';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';
import { containersReferencedInSource, containerReferences } from './containerScan';

/**
 * THE RATCHET. Raw `getContainer('<group-scoped>')` outside the allowlist is
 * a build error unless the file is on the backlog — and the backlog can only
 * SHRINK: a file that stops reading raw must be removed from it, or the test
 * fails the other way. So the sweep's progress is a diff on this list, and a
 * new route cannot quietly add a raw read.
 *
 * A test rather than an ESLint rule on purpose: a second `no-restricted-syntax`
 * block for the same files silently replaces the design-token rules
 * (CLAUDE.md documents the trap).
 */
const RAW_ACCESS_ALLOWLIST = new Set([
  'lib/groupScope.ts', // the accessor itself
  'lib/cosmos.ts', // the pointer helpers and dev seeds
  'lib/memberPurge.ts', // account deletion spans every group by design (person-level)
]);

/** Files still reading a GROUP_SCOPED container raw. Phase 1 empties this. */
const MIGRATION_BACKLOG = new Set([
  'app/api/admin/anomalies/route.ts',
  'app/api/admin/backfill-attendance/route.ts',
  'app/api/admin/ledger/route.ts',
  'app/api/admin/migrate-memberId/route.ts',
  'app/api/admin/owed-audit/route.ts',
  'app/api/admin/slice0/route.ts',
  'app/api/aliases/route.ts',
  'app/api/birds/reconcile/route.ts',
  'app/api/birds/route.ts',
  'app/api/kudos/route.ts',
  'app/api/members/[id]/history/route.ts',
  'app/api/members/me/route.ts',
  'app/api/members/route.ts',
  'app/api/players/unpaid/route.ts', // stringingJobs (Phase 1b); its session-family reads are swept
  'app/api/session/bird-usage/route.ts', // birds (Phase 1b); its session read is swept
  'app/api/stats/insight/route.ts',
  'app/api/stats/partners/route.ts',
  'app/api/stringing/jobs/[id]/accept/route.ts',
  'app/api/stringing/jobs/[id]/route.ts',
  'app/api/stringing/jobs/route.ts',
  'app/api/stringing/pricing/route.ts',
  'app/api/stringing/requests/route.ts',
  'app/api/stringing/shop/route.ts',
  'app/api/stringing/strings/route.ts',
  'app/opengraph-image.tsx',
  'lib/birdWrite.ts',
  'lib/events.ts',
  'lib/kudosEligibility.ts',
  'lib/levelStore.ts',
  'lib/playerIdentity.ts',
  'lib/stringingPricing.ts',
  'lib/stringingShop.ts',
  'lib/stringingStrings.ts',
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

  it('ratchets raw access to GROUP_SCOPED containers — the backlog only shrinks', () => {
    const { gotten } = containerReferences(join(__dirname, '..'));
    const raw = new Set<string>();
    for (const name of Object.keys(GROUP_SCOPED)) {
      for (const file of gotten.get(name) ?? []) raw.add(file);
    }
    const offenders = [...raw].filter((f) => !RAW_ACCESS_ALLOWLIST.has(f) && !MIGRATION_BACKLOG.has(f)).sort();
    expect(
      offenders,
      'These files read a GROUP_SCOPED container through raw getContainer(). Route the read ' +
        'through groupScope(groupId) from lib/groupScope.ts. (Adding a file to MIGRATION_BACKLOG ' +
        'is not the fix — that list only shrinks.)',
    ).toEqual([]);

    const done = [...MIGRATION_BACKLOG].filter((f) => !raw.has(f)).sort();
    expect(
      done,
      'These files no longer read raw — remove them from MIGRATION_BACKLOG so the ratchet holds.',
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
  });
});
