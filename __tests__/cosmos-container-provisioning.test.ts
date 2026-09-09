import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PROVISIONED_CONTAINERS } from '@/lib/containers';
import { containerReferences } from './containerScan';

/**
 * EVERY CONTAINER MUST EITHER ALREADY EXIST IN PRODUCTION OR BE ENSURED.
 *
 * Real Cosmos does not auto-create containers. The mock store does. That single
 * asymmetry means a brand-new container passes every test, every typecheck and
 * every lint, and then throws on its first production request — with the UI
 * showing whatever it shows when a promise never resolves.
 *
 * It has now happened twice. Most recently `pushSubscriptions` (PR #241,
 * revived 2026-08-28): `app/api/push/subscribe/route.ts` called
 * `getContainer('pushSubscriptions')` without ever ensuring it, so "Turn on
 * notifications" hung forever while 2454 tests stayed green.
 *
 * This is a SOURCE SCAN because nothing else can see it: no runtime test can
 * distinguish the mock's auto-create from a real provision.
 *
 * When you add a container, do ONE of:
 *   - call `ensureContainer('name', '/pk')` before using it (the lazy-memo
 *     pattern in lib/push.ts or lib/authHandoff.ts), or
 *   - add it to PROVISIONED below, once it genuinely exists in production.
 */

/**
 * Containers that exist in the production database, verified against
 * `az cosmosdb sql container list` on 2026-08-28. Recorded as `provisioned`
 * in the registry (`lib/containers.ts`) so this test, memberPurge and the
 * group accessor read ONE list. Marking one `provisioned: true` is a claim
 * about production, not a way to silence this test.
 */
const PROVISIONED = new Set<string>(PROVISIONED_CONTAINERS);

const ROOT = process.cwd();
// The shared scanner (containerScan.ts) resolves `const CONTAINER = '…'`
// aliases; this file's own literal-only regex could not see `authhandoff`.
const REFS = containerReferences(ROOT);

/** Every container name reachable via `getContainer` / `ensureContainer`. */
function containersUsed(): Map<string, string[]> {
  return REFS.used;
}

/** Container names that some module calls `ensureContainer` for. */
function containersEnsured(): Set<string> {
  return new Set(REFS.ensured.keys());
}

describe('Cosmos containers are provisioned before use', () => {
  it('finds container usage at all (guards against a regex that silently matches nothing)', () => {
    expect(containersUsed().size).toBeGreaterThan(5);
  });

  it('every getContainer() name is either already in production or ensured', () => {
    const used = containersUsed();
    const ensured = containersEnsured();

    const unprovisioned = [...used.entries()]
      .filter(([name]) => !PROVISIONED.has(name) && !ensured.has(name))
      .map(([name, files]) => `${name}  (used in: ${[...new Set(files)].join(', ')})`);

    expect(
      unprovisioned,
      'These containers do not exist in production and nothing calls ensureContainer for them. ' +
        'They will throw on the first real request while every test passes. ' +
        'Add an ensureContainer() guard, or add the name to PROVISIONED once it really exists.',
    ).toEqual([]);
  });

  /**
   * The specific regression. `pushSubscriptions` is NOT in PROVISIONED — it was
   * created by the ensure guard, and pinning it here would hide the very bug
   * this file exists for if the guard were ever removed.
   */
  it('pushSubscriptions is ensured, not assumed', () => {
    expect(containersEnsured().has('pushSubscriptions')).toBe(true);
    expect(PROVISIONED.has('pushSubscriptions')).toBe(false);
  });

  it('the subscribe route itself awaits the guard — it is the path that hung', () => {
    const route = readFileSync(join(ROOT, 'app/api/push/subscribe/route.ts'), 'utf8');
    expect(route).toContain('await ensurePushContainer()');
  });
});
