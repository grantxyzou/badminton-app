import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Single-instance registry.
 *
 * The app runs on ONE App Service instance, and several modules keep state in
 * process memory that is correct only while that stays true: a rate limiter
 * whose buckets live in a `Map`, a 5-second memo of the session pointer, a
 * calibration cache. CLAUDE.md names them in four separate places, each as a
 * comment beside the code ("on a single B1 instance this is what makes the
 * cache honest"). Prose like that is read once and then outlived by the code
 * around it, and a fifth such store could land in a PR with nobody noticing
 * that it had widened the assumption.
 *
 * This test is the registry. It scans every module-level `new Map(` / `new
 * Set(` declaration in `lib/` and `app/` whose name is not SCREAMING_CASE (a
 * SCREAMING_CASE Set or Map is a lookup table built from a literal list, not
 * state that changes between requests) and requires each one to be classified
 * below: where it runs, and what happens to it on scale-out. A site missing
 * from the registry fails the build with the line to add; a registry entry
 * whose site is gone fails too, so the list cannot outlive the code.
 *
 * `scaleOut` is the judgement a reviewer needs when the instance count ever
 * becomes 2:
 *   - 'safe'       — a per-process memo that costs a repeat round trip and
 *                    nothing else (container creation, in-flight dedupe).
 *   - 'multiplies' — a per-process LIMIT; N instances means N× the allowance,
 *                    which is a security property, not a performance one.
 *   - 'stale'      — a per-process copy of a shared value; another instance
 *                    reads the old one until the TTL expires.
 *   - 'browser'    — module state in a client component or hook; per tab, so
 *                    the instance count does not reach it at all.
 *
 * When a store is moved to Redis or Cosmos, delete its row here. When the
 * plan is to scale out, this list IS the migration plan.
 */

type ScaleOut = 'safe' | 'multiplies' | 'stale' | 'browser';

const REGISTRY: ReadonlyArray<{ file: string; name: string; scaleOut: ScaleOut; note: string }> = [
  { file: 'lib/rateLimit.ts', name: 'store', scaleOut: 'multiplies', note: 'per-IP and per-member limits; the sign-in throttle included' },
  { file: 'lib/cosmos.ts', name: 'ensured', scaleOut: 'safe', note: 'createIfNotExists memo; a second instance pays one extra metadata call per container' },
  { file: 'lib/cosmos.ts', name: 'pointerMemo', scaleOut: 'stale', note: '5 s per-group session-pointer memo; an advance on one instance reads old on another for up to POINTER_TTL_MS' },
  { file: 'lib/levelStore.ts', name: 'calCache', scaleOut: 'stale', note: 'group calibration, 30 s TTL; writers invalidate only their own process' },
  { file: 'app/api/equipment/catalog/route.ts', name: 'memo', scaleOut: 'stale', note: '60 s catalog memo; also honest only with real Cosmos (memoEnabled)' },
  { file: 'lib/sharedRead.ts', name: 'inflight', scaleOut: 'browser', note: 'client-side fetch dedupe for cards that mount together' },
  { file: 'lib/sharedRead.ts', name: 'inflightFetches', scaleOut: 'browser', note: 'client-side fetch dedupe for cards that mount together' },
  { file: 'lib/useInsight.ts', name: 'cache', scaleOut: 'browser', note: 'client hook' },
  { file: 'lib/useMemberAvatars.ts', name: 'byName', scaleOut: 'browser', note: 'client hook, module-cached roster avatars' },
  { file: 'lib/useMemberAvatars.ts', name: 'listeners', scaleOut: 'browser', note: 'client hook subscriber set' },
];

const ROOT = process.cwd();
const SCAN_DIRS = ['lib', 'app'];
const DECL = /^(?:export )?(?:const|let) ([A-Za-z_$][\w$]*)(?::\s*[^=]+)?\s*=\s*new (?:Map|Set)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Array<{ file: string; name: string }> {
  const found: Array<{ file: string; name: string }> = [];
  for (const dir of SCAN_DIRS) {
    for (const full of walk(join(ROOT, dir))) {
      const lines = readFileSync(full, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(DECL);
        if (!m) continue;
        const name = m[1];
        if (/^[A-Z0-9_]+$/.test(name)) continue; // lookup table, not state
        found.push({ file: relative(ROOT, full).replace(/\\/g, '/'), name });
      }
    }
  }
  return found;
}

const key = (s: { file: string; name: string }) => `${s.file} :: ${s.name}`;

describe('single-instance registry', () => {
  const sites = scan();
  const registered = new Set(REGISTRY.map(key));
  const present = new Set(sites.map(key));

  it('every module-level mutable Map/Set in lib/ and app/ is classified', () => {
    const missing = sites.filter((s) => !registered.has(key(s))).map(key);
    expect(
      missing,
      `Unclassified in-process state. Add each to REGISTRY in this file with where it runs and what scale-out does to it:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every registry row still points at live code', () => {
    const gone = REGISTRY.filter((r) => !present.has(key(r))).map(key);
    expect(gone, `Registry rows whose store no longer exists (delete them):\n  ${gone.join('\n  ')}`).toEqual([]);
  });

  it('the server-side stores that multiply or go stale are the ones CLAUDE.md warns about', () => {
    // A reader of CLAUDE.md's "In-memory rate limiter … Single-instance only"
    // and the pointer-memo gotcha should find the same files here. Pin the
    // set so the two cannot drift apart silently.
    const risky = REGISTRY.filter((r) => r.scaleOut === 'multiplies' || r.scaleOut === 'stale').map((r) => r.file);
    expect(new Set(risky)).toEqual(new Set(['lib/rateLimit.ts', 'lib/cosmos.ts', 'lib/levelStore.ts', 'app/api/equipment/catalog/route.ts']));
  });

  it('the scanner itself still finds the rate limiter (a regex that matches nothing passes vacuously)', () => {
    expect(present.has('lib/rateLimit.ts :: store')).toBe(true);
  });
});
