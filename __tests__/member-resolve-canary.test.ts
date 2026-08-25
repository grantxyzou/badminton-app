import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Member-resolver canary — name→memberId has exactly ONE owner.
 *
 * `lib/memberResolve.ts` owns the lookup. It existed as ten hand-copied
 * variants, drifted on the one thing that decides identity: six omitted
 * `AND c.active = true`, three included it, and `recommend`'s copy carried a
 * comment demanding parity with `equipment/gear` while saying nothing about the
 * other six. `members` is partitioned on `/id`, so a `LOWER(c.name)` lookup is
 * cross-partition and `resources[0]` with no `ORDER BY` is not a stable pick —
 * yet that id is the storage key for drills, assessments, kudos and gear.
 *
 * A copy is invisible in behaviour tests (it returns the same id whenever no
 * duplicate rows exist), so this pins the structure instead: a members-container
 * name lookup may appear only in the owning module or on the allowlist below.
 *
 * The allowlist IS the documentation of which lookups are deliberately
 * different. Every entry needs a reason, not just a path.
 */

/** `LOWER(c.name)` / `STRINGEQUALS(c.name` against the members container. */
const LOOKUP = /LOWER\(c\.name\)|STRINGEQUALS\(c\.name/;

const OWNER = join('lib', 'memberResolve.ts');

const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  [join('lib', 'playerIdentity.ts'),
   'different shape: returns a whole Member with alias expansion, for /players/unpaid and /admin/owed-audit'],
  [join('app', 'api', 'stats', 'insight', 'route.ts'),
   "needs the member's CANONICAL stored name (flows into the AI prose), not the trimmed query string"],
  [join('app', 'api', 'stats', 'club', 'bands', 'route.ts'),
   'readPrivacy reads statsPrivacy, which is WRITTEN to the active row by members/me — a different key, correctly filtered'],
  [join('app', 'api', 'members', 'route.ts'), 'the members directory itself'],
  [join('app', 'api', 'members', 'me', 'route.ts'), 'self-service member record'],
  [join('app', 'api', 'players', 'route.ts'), 'sign-up: matches a member to a player row'],
  [join('app', 'api', 'players', 'recover', 'route.ts'), 'PIN sign-in'],
  [join('app', 'api', 'players', 'reset-access', 'route.ts'), 'recovery-code path'],
  [join('app', 'api', 'admin', 'route.ts'), 'admin login'],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = ['app', 'lib'].flatMap((r) => walk(join(process.cwd(), r)));
const allowed = new Set(ALLOWED.map(([p]) => p));

describe('member-resolve canary', () => {
  it('has no members-container name lookup outside the owner or the allowlist', () => {
    const offenders = files
      .map((f) => [f.replace(process.cwd() + '/', ''), readFileSync(f, 'utf8')] as const)
      .filter(([rel, src]) => LOOKUP.test(src) && src.includes("'members'") && rel !== OWNER && !allowed.has(rel))
      .map(([rel]) => rel);

    expect(
      offenders,
      `name→memberId must come from ${OWNER}. These re-derive it:\n  ${offenders.join('\n  ')}\n` +
        'Use resolveAnyMemberSubject / resolveActiveSubject / resolveActiveMemberId, or add an\n' +
        'allowlist entry WITH A REASON if the lookup is genuinely different.',
    ).toEqual([]);
  });

  it('resolves the ACTIVE row only — there is no unfiltered path left', () => {
    const src = readFileSync(join(process.cwd(), OWNER), 'utf8');
    expect(src).toContain('AND c.active = true');
    expect(src).toMatch(/resolveActiveMemberId/);
    expect(src).toMatch(/resolveActiveSubject/);
    // The unfiltered variant existed only to make the consolidation
    // behaviour-neutral; it was removed once the six stats routes were flipped.
    // Re-adding one means re-running the production duplicate/inactive audit.
    expect(src).not.toMatch(/export .*resolveAnyMemberSubject/);
  });

  it('does not export a boolean-flag entry point', () => {
    // A `resolveMember(name, { activeOnly })` would make the call greppable
    // while moving the drift into the argument — the failure being fixed.
    const src = readFileSync(join(process.cwd(), OWNER), 'utf8');
    expect(src).not.toMatch(/export .*activeOnly/);
  });
});
