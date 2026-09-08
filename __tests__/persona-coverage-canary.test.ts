import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Persona-coverage canary — a caller of `/api/claude` asks for the app's voice,
 * or says in writing why it doesn't.
 *
 * `lib/aiPersona.ts` is the single owner of how this app sounds, and its opening
 * sentence — "every Claude prompt that produces player-facing text prepends
 * VOICE_PERSONA" — was ASPIRATIONAL for months. One of three call sites did it.
 * The announcement-polish and release-note paths wrote their own tone adjectives
 * inline while publishing text every player reads.
 *
 * That was fixed on 2026-09-07 by making the route take `persona: true`. The fix
 * is opt-in, which leaves an obvious way for it to come undone: a FOURTH caller
 * appears and simply doesn't pass the flag, and the claim in `aiPersona.ts` is
 * quietly false again in exactly the same way.
 *
 * `docs/plans/ai-governance-and-docs-accuracy.md` wrote that down as a kill
 * criterion — a thing to notice later. This test is that criterion moved from
 * prose into the build, which is the whole difference between a note and a gate:
 * it fires on the pull request that introduces the fourth caller, not on whoever
 * happens to re-read a plan doc afterwards. Prose is how the flag-retirement
 * field died here once already.
 *
 * If a genuinely unstyled call is ever wanted — a data extraction, a summary the
 * admin rewrites anyway — that is FINE. Add it to ALLOWED with a reason. The
 * allowlist is the record of which calls are deliberately voiceless, and a
 * reason is the part a future reader actually needs.
 */

/**
 * A CALL to the shared prose endpoint, however the URL is assembled.
 *
 * Anchored on `fetch(` deliberately. The first cut matched any quoted
 * `/api/claude`, which flagged `lib/aiError.ts` — a file whose docstring
 * discusses the route at length and never calls it. Allowlisting that would have
 * been the wrong repair twice over: it isn't a caller, so the entry would have
 * asserted something false, and the next reader would have inherited a canary
 * whose exemption list described the code incorrectly.
 */
const CALLS_CLAUDE = /fetch\(\s*[^)]*\/api\/claude/;

/** The flag that opts a call into the shared voice. */
const ASKS_FOR_PERSONA = /persona:\s*true/;

const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  // Intentionally empty. Both current callers publish player-facing text and
  // both pass the flag. An entry here means "this output is never read by a
  // player, or is deliberately unstyled" — say which.
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

// `app` is included as well as `components`: the route itself lives there, and a
// future server-side caller would too.
const files = ['app', 'components', 'lib'].flatMap((r) => walk(join(process.cwd(), r)));
const allowed = new Set(ALLOWED.map(([p]) => p));

/** The route's own file defines the endpoint; it is not a caller of it. */
const ROUTE = join('app', 'api', 'claude', 'route.ts');

describe('persona coverage canary', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken walk makes the assertion below vacuous.
    expect(files.length).toBeGreaterThan(50);
  });

  it('every caller of /api/claude opts into the shared voice', () => {
    const offenders = files
      .map((f) => [f.replace(process.cwd() + '/', ''), readFileSync(f, 'utf8')] as const)
      .filter(([rel]) => rel !== ROUTE && !allowed.has(rel))
      .filter(([, src]) => CALLS_CLAUDE.test(src) && !ASKS_FOR_PERSONA.test(src))
      .map(([rel]) => rel);

    expect(
      offenders,
      'These call /api/claude without `persona: true`:\n  ' +
        `${offenders.join('\n  ')}\n` +
        'Text that any player reads must speak in the voice lib/aiPersona.ts owns.\n' +
        'If this output is genuinely never seen by a player, add it to ALLOWED WITH A REASON.',
    ).toEqual([]);
  });

  it('finds the callers it is supposed to be guarding', () => {
    // Without this the test passes just as well when the regex stops matching
    // anything at all — which is the failure mode a canary is least able to
    // notice about itself.
    const callers = files.filter(
      (f) => f.replace(process.cwd() + '/', '') !== ROUTE && CALLS_CLAUDE.test(readFileSync(f, 'utf8')),
    );
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });
});
