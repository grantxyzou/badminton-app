import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A CLUB AGGREGATE OVER A PERSON CONTAINER MUST BE NARROWED TO THE ROSTER.
 *
 * This gate exists because the same bug was found by hand three times in one
 * day, in three places, long after the rule was written down.
 *
 * The rule itself is in CLAUDE.md and is not in dispute: `assessments`,
 * `playerGear` and their siblings belong to a PERSON, who may be in two clubs,
 * so no `groupId` on the row can separate them and `groupScope` would be WRONG
 * here — a raw `getContainer` is correct. What is not optional is what happens
 * next: if the read then TOTALS, COUNTS or LISTS across people, it is a club
 * aggregate, and the only thing that can bound it to one club is the roster.
 *
 * Phase 2 established that and fixed `stats/club/bands` and `stats/club/gear`.
 * Nothing checked the rest, and three more were still reading the whole
 * deployment months later:
 *
 *   - `admin/slice0`'s `racketSavers` counted every saved racket anywhere. One
 *     club's figure was 3 when one saver was on its roster.
 *   - `/api/recommend`'s club tally grounded "players around your level reach
 *     for X" in the bags of a club the reader is not in.
 *   - `admin/fit-preview` let ANY club's admin dump every club's check-in
 *     ratings and bags — it is gated by the sync `isAdminAuthed`, which proves
 *     you are an admin somewhere, never that you are an admin here.
 *
 * None of them looked broken. A metric that is too HIGH reads as a good week.
 *
 * HOW THIS DETECTS IT: a file that raw-reads a person container AND issues a
 * whole-container scan (`SELECT … FROM c` with no WHERE) must either narrow
 * through `rosterMemberIds` / `rosterMembers`, or be listed below with a
 * reason. A WHERE-bound read is somebody's own data and is not an aggregate.
 *
 * It is a heuristic and deliberately a crude one. It cannot prove an aggregate
 * is correctly narrowed — only that the question was asked within sight of the
 * scan. That is the same bargain `group-scope-coverage` makes.
 *
 * All three bugs above trip it, and that was CHECKED rather than assumed: the
 * first cut asked the question per FILE and missed `slice0`, the one it was
 * written for, because that file narrows one aggregate and not the other. See
 * `unnarrowedScans`.
 */

/** Files that scan a person container deployment-wide ON PURPOSE. */
const DEPLOYMENT_WIDE: Record<string, string> = {
  'lib/groupBackfill.ts':
    'The migration itself. It exists to visit every row in the deployment and stamp it; a roster ' +
    'narrowing would defeat the one thing it is for.',
  'app/api/admin/migrate-memberId/route.ts':
    'A one-shot migration over every Member, from before groups existed. Same argument.',
  'lib/push.ts':
    'The only sender. `loadSubscriptions(memberIds?)` scans and then JS-filters to the ids the ' +
    'CALLER supplied, so the narrowing is the caller\'s and is explicit at every call site — ' +
    '`app/api/session` passes `rosterMemberIds()`. `sendPushToAll` has no caller in app code.',
  'app/api/push/subscribe/route.ts':
    'Device management for ONE member: `loadForMember` scans then filters by `memberId`, with the ' +
    'mock-parity reason stated at the function. Never totals across people.',
};

const PERSON_SCOPED = (() => {
  const src = readFileSync('lib/containers.ts', 'utf8');
  return [...src.matchAll(/^ {2}([a-zA-Z]+): \{ pk: '[^']+', scope: 'person'/gm)].map((m) => m[1]);
})();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** `SELECT … FROM c` with no WHERE — i.e. the whole container. */
function wholeContainerScans(src: string): string[] {
  const found = [...src.matchAll(/query:\s*'([^']*\bFROM c\b[^']*)'/g)].map((m) => m[1]);
  return found.filter((q) => !/\bWHERE\b/i.test(q));
}

/**
 * Anything that reads as "and then I checked the roster". Deliberately broad:
 * the point is whether the question was asked at this scan, not how.
 */
const NARROWING = /roster|onRoster|memberIds\.has|allowed\.has/i;

/**
 * How far after a scan the narrowing may sit, in lines.
 *
 * MEASURED, not guessed. Across the five correct aggregates in the app the
 * narrowing sits between 2 and 14 lines after its scan; `slice0`'s original bug
 * had its nearest mention of a roster 18 lines away — and that mention belonged
 * to the NEXT aggregate, which is exactly how a per-file check waved it through.
 * 16 is the gap between those.
 *
 * That margin is thin, and it should be read as a nudge rather than a law: if a
 * correct aggregate ever trips this, the fix is to move the narrowing nearer
 * its scan, which is better code anyway. Re-measure before widening it.
 */
const WINDOW = 16;

/**
 * PER SCAN, not per file — and that distinction is the whole reason this gate
 * is worth having.
 *
 * The first cut asked "does this FILE mention the roster anywhere?", and it
 * caught two of the three bugs above while missing `slice0` — the very file the
 * gate was written for. `slice0` narrows its `assessments` aggregate through
 * `rosterKey` and did NOT narrow its `playerGear` one, so a file-level question
 * answered yes on the strength of the aggregate that was already correct.
 *
 * A file that gets it right once and wrong once is the likeliest shape of this
 * bug, not the least. So each scan is judged where it stands.
 */
function unnarrowedScans(src: string): string[] {
  const lines = src.split('\n');
  const bad: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/query:\s*'([^']*\bFROM c\b[^']*)'/);
    if (!m || /\bWHERE\b/i.test(m[1])) return;
    const after = lines.slice(i, i + WINDOW).join('\n');
    if (!NARROWING.test(after)) bad.push(m[1]);
  });
  return bad;
}

describe('club aggregates over PERSON containers are narrowed to the roster', () => {
  it('has person-scoped containers to check (the registry is the source)', () => {
    // If this ever reads empty the whole suite below passes vacuously.
    expect(PERSON_SCOPED.length).toBeGreaterThan(3);
    expect(PERSON_SCOPED).toContain('playerGear');
    expect(PERSON_SCOPED).toContain('assessments');
  });

  it('every whole-container scan either narrows or is listed with a reason', () => {
    const offenders: string[] = [];

    for (const file of [...walk('app'), ...walk('lib')]) {
      const src = readFileSync(file, 'utf8');
      const containers = PERSON_SCOPED.filter((c) => src.includes(`getContainer('${c}')`));
      if (containers.length === 0) continue;

      if (DEPLOYMENT_WIDE[file]) continue;

      const bare = unnarrowedScans(src);
      if (bare.length === 0) continue;

      offenders.push(`${file} scans ${containers.join(', ')} whole, unnarrowed: ${bare[0]}`);
    }

    // A new one here means: either narrow it through `rosterMemberIds`, or add
    // it to DEPLOYMENT_WIDE with the reason it is allowed to see every club.
    expect(offenders).toEqual([]);
  });

  it('the allowlist has no dead entries', () => {
    // A stale exemption is worse than none: it reads as a considered decision
    // about a file that no longer does the thing.
    const dead = Object.keys(DEPLOYMENT_WIDE).filter((file) => {
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        return true; // the file is gone
      }
      const touchesPerson = PERSON_SCOPED.some((c) => src.includes(`getContainer('${c}')`));
      return !touchesPerson || wholeContainerScans(src).length === 0;
    });
    expect(dead).toEqual([]);
  });

  it('every allowlist entry states a reason', () => {
    for (const [file, reason] of Object.entries(DEPLOYMENT_WIDE)) {
      expect(reason.length, `${file} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });
});
