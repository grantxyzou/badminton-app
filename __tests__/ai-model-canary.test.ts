import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * AI-model canary — the model-ID analogue of __tests__/design-canary.test.ts.
 *
 * Anthropic model IDs are retired over time, and a retired ID fails ONLY at
 * runtime, as a 404 from the API. `app/api/claude/route.ts` pinned
 * `claude-sonnet-4-20250514` long after it was retired: every call 404'd, the
 * catch turned it into a generic "AI request failed", and the admin release-note
 * and announcement polish were dead in production with no test failing.
 *
 * This is a DENYLIST, deliberately — asserting membership in a list of
 * currently-supported models would rot the day a new model ships or another
 * retires, and would then fail for the wrong reason. No unit test can catch a
 * FUTURE retirement (that protection is error legibility, not assertions), but
 * this pins the ones already known dead so they can't be reintroduced.
 *
 * When a model is retired, add its ID here in the same commit that migrates off
 * it.
 */
const RETIRED_MODEL_IDS = [
  // 404 not_found_error as of 2026-08-20; was live in app/api/claude/route.ts.
  'claude-sonnet-4-20250514',
];

/** Source roots that can reach the Anthropic API at runtime. */
const SOURCE_ROOTS = ['app', 'lib', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('AI model canary', () => {
  const files = SOURCE_ROOTS.flatMap((r) => walk(join(process.cwd(), r)));

  it('scans a non-trivial number of source files', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(50);
  });

  for (const retired of RETIRED_MODEL_IDS) {
    it(`does not reference the retired model ${retired}`, () => {
      const offenders = files
        .filter((f) => readFileSync(f, 'utf8').includes(retired))
        .map((f) => f.replace(process.cwd() + '/', ''));
      expect(offenders).toEqual([]);
    });
  }
});
