import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';

/**
 * THE CANARY THAT STOPS ACCOUNT DELETION GOING QUIETLY STALE.
 *
 * `purgeMember` is table-driven, and a table is only as good as the day it was
 * written. The next person to add a container will not think about account
 * deletion — nobody does — and the failure is silent in exactly the way this
 * repo has been burned by before: the catalog-seeding bug shipped because local
 * tests passed while production skipped 50 of 71 rows.
 *
 * So this scans the SOURCE for every container name the app touches and forces
 * each one to be classified. Adding a container without deciding whether it
 * holds member data fails the build, and the fix is to add one line to one of
 * the two lists in `lib/memberPurge.ts`.
 *
 * A source scan and not a runtime check on purpose: at runtime a container that
 * is never touched by the tests is indistinguishable from one that does not
 * exist, which is the whole problem.
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

function containersReferencedInSource(): Set<string> {
  const root = join(__dirname, '..');
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:get|ensure)Container\(\s*'([a-zA-Z]+)'/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

describe('account deletion covers every container', () => {
  it('classifies every container the app touches', () => {
    const referenced = containersReferencedInSource();
    // Sanity: if the scan finds nothing the regex has rotted and the rest of
    // this file would pass vacuously.
    expect(referenced.size).toBeGreaterThan(10);

    const classified = new Set([
      ...OWNED_CONTAINERS,
      ...Object.keys(NOT_MEMBER_SCOPED),
      ...Object.keys(CLASSIFIED_ELSEWHERE),
    ]);
    const unclassified = [...referenced].filter((c) => !classified.has(c)).sort();

    expect(
      unclassified,
      `Unclassified container(s): ${unclassified.join(', ')}.\n` +
        'A new container must be added to one of the three lists in ' +
        'lib/memberPurge.ts: OWNED (deleted when a member deletes their ' +
        'account), CLASSIFIED_ELSEWHERE (member data handled by a dedicated ' +
        'function), or NOT_MEMBER_SCOPED (genuinely club-wide, with a reason). ' +
        'Account deletion is an App Store requirement and a privacy obligation; ' +
        'a container nobody classified is data that silently survives a ' +
        'deletion request.',
    ).toEqual([]);
  });

  it('never classifies one container two ways', () => {
    const lists: [string, string[]][] = [
      ['OWNED', [...OWNED_CONTAINERS]],
      ['NOT_MEMBER_SCOPED', Object.keys(NOT_MEMBER_SCOPED)],
      ['CLASSIFIED_ELSEWHERE', Object.keys(CLASSIFIED_ELSEWHERE)],
    ];
    for (const [nameA, a] of lists) {
      for (const [nameB, b] of lists) {
        if (nameA >= nameB) continue;
        const overlap = a.filter((c) => b.includes(c));
        expect(overlap, `${nameA} and ${nameB} both claim: ${overlap.join(', ')}`).toEqual([]);
      }
    }
  });

  /**
   * The reason string is the whole point of the two exclusion lists: it is what
   * distinguishes a considered decision from a container someone waved past.
   */
  it('gives every excluded container a stated reason', () => {
    const excluded = { ...NOT_MEMBER_SCOPED, ...CLASSIFIED_ELSEWHERE };
    for (const [container, reason] of Object.entries(excluded)) {
      expect(reason.length, `${container} needs a real reason`).toBeGreaterThan(15);
    }
  });

  /**
   * `NOT_MEMBER_SCOPED` used to hold `players`, `gameResults`, `feedback` and
   * `members` too, which made its name assert something false about four
   * containers that hold personal data. Splitting them out only helps if they
   * stay split.
   */
  it('keeps personal-data containers out of the "not member scoped" list', () => {
    for (const container of ['players', 'gameResults', 'feedback', 'members']) {
      expect(
        NOT_MEMBER_SCOPED[container],
        `${container} holds member data — it belongs in CLASSIFIED_ELSEWHERE`,
      ).toBeUndefined();
    }
  });
});
