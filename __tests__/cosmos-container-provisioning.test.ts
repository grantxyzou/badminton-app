import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

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
 * `az cosmosdb sql container list` on 2026-08-28. Adding a name here is a
 * claim about production, not a way to silence this test.
 */
const PROVISIONED = new Set([
  'aliases',
  'announcements',
  'assessments',
  'authhandoff',
  'birds',
  'clubSettings',
  'drillCompletions',
  'equipmentCatalog',
  'events',
  'feedback',
  'gameResults',
  'identities',
  'insights',
  'kudos',
  'members',
  'playerGear',
  'players',
  'releases',
  'sessions',
  'skills',
  'stringingJobs',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const ROOT = process.cwd();
const SOURCES = [join(ROOT, 'app'), join(ROOT, 'lib')].flatMap((d) => walk(d));
const ALL_TEXT = SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Every container name reachable via `getContainer('…')`. */
function containersUsed(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/getContainer\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)) {
      const name = m[1];
      used.set(name, [...(used.get(name) ?? []), file.replace(ROOT + '/', '')]);
    }
  }
  return used;
}

/** Container names that some module calls `ensureContainer` for. */
function containersEnsured(): Set<string> {
  const ensured = new Set<string>();
  for (const m of ALL_TEXT.matchAll(/ensureContainer\(\s*['"]([A-Za-z0-9_]+)['"]/g)) {
    ensured.add(m[1]);
  }
  return ensured;
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
