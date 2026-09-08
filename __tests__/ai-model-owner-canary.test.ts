import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROSE_MODEL, INSIGHT_MODEL } from '@/lib/aiModels';

/**
 * Model-ID owner canary — an Anthropic model ID appears in exactly ONE file.
 *
 * The twin of `__tests__/ai-model-canary.test.ts`, and they do different jobs.
 * That one is a denylist: it refuses IDs already known dead, which protects against
 * repeating the last outage and nothing else. No test can know that a live ID is
 * about to be retired — so the only thing that helps with the NEXT one is making the
 * migration cheap and total, which means one file to edit and no second copy left
 * behind in a route nobody thought to grep.
 *
 * Two call sites is exactly the size at which this rots quietly: small enough that
 * a second copy feels harmless, large enough that a grep for one string misses the
 * other. `lib/aiModels.ts` owns both; this pins that.
 *
 * The allowlist IS the record of deliberate exceptions. Every entry carries a
 * reason, following `member-resolve-canary` — a path alone tells a future reader
 * nothing about whether the exception still holds.
 */

/** Any Anthropic model ID: family plus version tail. */
const MODEL_ID = /claude-(?:sonnet|opus|haiku|fable)-[\w.-]+/;

const OWNER = join('lib', 'aiModels.ts');

const ALLOWED: ReadonlyArray<readonly [string, string]> = [
  // Intentionally empty. Both call sites import from the owner; a genuinely
  // different need (a one-off model for an experiment, say) goes here WITH a reason.
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

const files = ['app', 'lib', 'components'].flatMap((r) => walk(join(process.cwd(), r)));
const allowed = new Set(ALLOWED.map(([p]) => p));

describe('AI model-ID owner canary', () => {
  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken walk makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no model ID outside the owner or the allowlist', () => {
    const offenders = files
      .map((f) => [f.replace(process.cwd() + '/', ''), readFileSync(f, 'utf8')] as const)
      .filter(([rel, src]) => MODEL_ID.test(src) && rel !== OWNER && !allowed.has(rel))
      .map(([rel]) => rel);

    expect(
      offenders,
      `Anthropic model IDs live in ${OWNER}. These pin one directly:\n  ${offenders.join('\n  ')}\n` +
        'Import PROSE_MODEL / INSIGHT_MODEL, or add an allowlist entry WITH A REASON.',
    ).toEqual([]);
  });

  it('the owner actually exports usable IDs', () => {
    // Without this, emptying the module would satisfy the scan above perfectly.
    for (const [name, id] of [['PROSE_MODEL', PROSE_MODEL], ['INSIGHT_MODEL', INSIGHT_MODEL]]) {
      expect(id, name).toMatch(MODEL_ID);
    }
  });
});
