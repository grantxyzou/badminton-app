import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { GROUP_SCOPED, PERSON_SCOPED, GLOBAL } from '@/lib/groupScope';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';

/**
 * THE CANARY THAT STOPS A CONTAINER SLIPPING BETWEEN GROUPS UNCLASSIFIED.
 *
 * Same shape as `member-purge-coverage.test.ts`, for the same reason: a table
 * is only as good as the day it was written, and the next person to add a
 * container will not think about tenancy. A container that nobody decided is
 * GROUP / PERSON / GLOBAL is one whose rows every group can read.
 *
 * Source scan, not runtime, on purpose (see the purge canary's docstring).
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Resolves single-level `const X = '…'` aliases too — `authhandoff` hid behind one. */
function containersReferencedInSource(): Set<string> {
  const root = join(__dirname, '..');
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:get|ensure)Container\(\s*'([a-zA-Z]+)'/g)) found.add(m[1]);
    const aliases = new Map<string, string>();
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([a-zA-Z]+)'/g)) {
      aliases.set(m[1], m[2]);
    }
    for (const m of src.matchAll(/(?:get|ensure)Container\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      const resolved = aliases.get(m[1]);
      if (resolved) found.add(resolved);
    }
  }
  return found;
}

const lists: [string, string[]][] = [
  ['GROUP_SCOPED', Object.keys(GROUP_SCOPED)],
  ['PERSON_SCOPED', Object.keys(PERSON_SCOPED)],
  ['GLOBAL', Object.keys(GLOBAL)],
];

describe('group scoping classifies every container', () => {
  it('classifies every container the app touches', () => {
    const referenced = containersReferencedInSource();
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

  it('never classifies one container two ways', () => {
    for (const [nameA, a] of lists) {
      for (const [nameB, b] of lists) {
        if (nameA >= nameB) continue;
        const overlap = a.filter((c) => b.includes(c));
        expect(overlap, `${nameA} and ${nameB} both claim: ${overlap.join(', ')}`).toEqual([]);
      }
    }
  });

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
