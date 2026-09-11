import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A NAME-KEYED READ MUST BE GATED, WHEREVER IT LIVES.
 *
 * A member's display name is not a credential. `GET /api/members` hands out
 * every name to anyone, so "the caller knew the name" proves nothing, and any
 * handler that takes `?name=` and answers with that person's stored data is
 * public unless it says otherwise.
 *
 * This has now been found by hand twice, in two separate sweeps.
 *
 *   - `/stats/insight`, `/stats/partners` and `/stats/attendance` each shipped
 *     with no auth at all, serving one member's AI coaching prose, social graph
 *     and attendance history to any caller. The fix put the three-line check
 *     into `ownsNameOrAdmin` so a missing CALL would at least be greppable, and
 *     its docstring offers that grep:
 *
 *         grep -L ownsNameOrAdmin app/api/stats/**\/route.ts
 *
 *   - That grep is the reason for the second sweep. It asks "does this live
 *     under app/api/stats?" when the question is "is this read keyed by a
 *     name?", and those are not the same set. `GET /api/assessments` answered
 *     any caller with a named member's per-skill self-assessment history —
 *     the raw ratings `lib/clubBands.ts` deliberately coarsens to thirds
 *     because an exact percentile is de-anonymising — and
 *     `GET /api/games?all=true&name=` handed over the club's entire match
 *     record. Neither is under `app/api/stats`.
 *
 * So the gate is now enforced by SHAPE rather than by directory: every handler
 * under `app/api` that reads a name from the query string must either call
 * `ownsNameOrAdmin`, be admin-only, or be listed below with a reason.
 *
 * PER HANDLER, NOT PER FILE — the lesson from `person-aggregate-coverage`,
 * whose first cut asked per file and missed the very bug it was written for. A
 * route that gates its GET and not its DELETE is the likeliest shape of this,
 * not the least, so each exported handler is judged where it stands.
 *
 * WHAT THIS CANNOT DO, stated so nobody reads more into a green run than is
 * there: it proves a gate was CALLED inside the handler, never that the gate
 * covers every branch or that its verdict is used. A handler that gates one
 * field and answers another to a stranger passes — `GET /api/members/me` is
 * exactly that, deliberately, and is listed in EXEMPT to record the split even
 * though it would pass without the entry. What the check does catch is a
 * handler with no gate at all, which is what both sweeps above actually found.
 * That is the same bargain the sibling canaries make.
 *
 * It is also why an INLINE copy of the check does not count — three routes had
 * drifted into three spellings of one rule, and a hand-rolled comparison is
 * exactly what the named helper exists to replace, being invisible to any grep.
 */

/** Handlers that read a name and are allowed not to call `ownsNameOrAdmin`. */
const EXEMPT: Record<string, string> = {
  'app/api/members/me/route.ts GET':
    'THE anonymous probe, deliberately. The adaptive sign-up form has to know whether a name ' +
    'exists and whether it has a PIN before anybody has proved anything — that is what chooses ' +
    'between anon, sign-in and create mode. It answers `hasPin` and `createdAt` to anyone and ' +
    'withholds `role` and `statsPrivacy` unless the caller is that member or an admin, which is ' +
    'the split this exemption is narrow to.',
  'app/api/equipment/gear/route.ts GET':
    'Gates on memberId EQUALITY (`caller?.memberId !== memberId`), not on the name. That is the ' +
    'stronger form of this rule — an id is neither mutable nor per-club — and it must not be ' +
    'downgraded to a name comparison just to satisfy a grep.',
  'app/api/admin/owed-audit/route.ts GET':
    'Admin-only (`isAdminAuthed` at the top). The name selects which member to audit; it is not ' +
    'the thing being trusted.',
};

/** Every `route.ts` under `app/api`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/**
 * Reading a name out of the query string.
 *
 * Matched on `.get('name')` against ANY receiver, not on `searchParams.get`,
 * because the receiver is routinely aliased first — `GET /api/games` does
 * `const params = new URL(req.url).searchParams` and then `params.get('name')`,
 * and a `searchParams.get` pattern does not see it. That alias alone hid the
 * `?all=true&name=` history dump from this check while it sat two lines from
 * the fix for it.
 *
 * A name arriving in a JSON BODY is not in scope: those are writes, covered by
 * rule 12's memberId binding rather than by this gate.
 */
const READS_NAME = /\.get\(\s*['"]name['"]\s*\)/;

/**
 * The gate, or a gate at least as strong.
 *
 * `authorizeBagWrite` is here because it is a NAMED shared gate — the same kind
 * of thing as `ownsNameOrAdmin`, just owned by the equipment routes, and
 * equally findable. What is excluded is the INLINE copy: a hand-rolled
 * `member?.name?.toLowerCase() === name.toLowerCase()` is invisible to every
 * grep, and three routes had drifted into three spellings of one rule before
 * this file existed. The distinction is greppability, not trust.
 *
 * A BARE ADMIN CHECK IS NOT A NAME GATE, and leaving it in here cost this file
 * its first real catch. `isAdminAuthed` appears all over for reasons that have
 * nothing to do with names — rule 7's `?sessionId=` override most of all — and
 * `GET /api/games` carries one in its default branch. So with `isAdminAuthed`
 * accepted, deleting the gate from the all-time branch left the handler still
 * matching, and the canary passed on the exact bug it was written for. Only the
 * two name-shaped gates count; a genuinely admin-only handler goes in EXEMPT,
 * where the claim is written down instead of inferred from a substring.
 */
const GATED = /ownsNameOrAdmin\s*\(|authorizeBagWrite\s*\(/;

/**
 * Split a route file into its exported handlers, so each is judged alone.
 *
 * Everything above the first handler (imports, helpers, constants) is dropped:
 * a gate defined in a shared helper up there is not a gate this handler calls,
 * and counting it is precisely the per-file mistake.
 */
function handlers(src: string): { name: string; body: string }[] {
  const re = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/g;
  const starts: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
  return starts.map((s, i) => ({
    name: s.name,
    body: src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length),
  }));
}

describe('name-keyed reads are gated, by shape and not by directory', () => {
  it('finds handlers to check (an empty scan would pass vacuously)', () => {
    const files = walk(join(process.cwd(), 'app', 'api'));
    expect(files.length).toBeGreaterThan(20);
    const withName = files.filter((f) => READS_NAME.test(readFileSync(f, 'utf8')));
    expect(withName.length).toBeGreaterThan(5);
  });

  it('every handler that takes ?name= calls the gate, or is exempt with a reason', () => {
    const root = process.cwd();
    const offenders: string[] = [];

    for (const file of walk(join(root, 'app', 'api'))) {
      const rel = file.slice(root.length + 1);
      const src = readFileSync(file, 'utf8');
      if (!READS_NAME.test(src)) continue;

      for (const h of handlers(src)) {
        if (!READS_NAME.test(h.body)) continue;
        if (GATED.test(h.body)) continue;
        if (EXEMPT[`${rel} ${h.name}`]) continue;
        offenders.push(`${rel} ${h.name}`);
      }
    }

    // A new entry here means: call `ownsNameOrAdmin` right after parsing the
    // name, or add it to EXEMPT with the reason it may answer a stranger.
    expect(offenders).toEqual([]);
  });

  it('the exemption list has no dead entries', () => {
    // A stale exemption is worse than none: it reads as a decision somebody
    // made, when it is really a line nobody reduced after the code moved.
    const root = process.cwd();
    const live = new Set<string>();
    for (const file of walk(join(root, 'app', 'api'))) {
      const rel = file.slice(root.length + 1);
      const src = readFileSync(file, 'utf8');
      if (!READS_NAME.test(src)) continue;
      for (const h of handlers(src)) {
        if (READS_NAME.test(h.body)) live.add(`${rel} ${h.name}`);
      }
    }
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });

  it('every exemption states a reason, not just a key', () => {
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${key} needs a real reason`).toBeGreaterThan(40);
    }
  });
});
