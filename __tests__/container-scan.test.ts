import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { containerReferences, containersReferencedInSource } from './containerScan';

/**
 * The scanner the container canaries share. Tested against a throwaway tree
 * because the failure it guards against is silent: a container hidden behind
 * `const CONTAINER = '…'` was invisible to a literal-only scan, and
 * `authhandoff` shipped un-purged while every canary sat green.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'container-scan-'));
  dirs.push(root);
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'lib'));
  for (const [rel, src] of Object.entries(files)) writeFileSync(join(root, rel), src);
  return root;
}

describe('containerReferences', () => {
  it('sees a container used through a const alias, and the path it was ensured with', () => {
    const root = fixture({
      'lib/a.ts': "const CONTAINER = 'hidden';\nexport async function f() { await ensureContainer(CONTAINER, '/id'); return getContainer(CONTAINER); }\n",
      'app/b.ts': "export const c = getContainer('plain');\n",
    });
    const refs = containerReferences(root);
    expect([...refs.used.keys()].sort()).toEqual(['hidden', 'plain']);
    expect(refs.used.get('hidden')).toEqual(['lib/a.ts']);
    expect(refs.ensured.get('hidden')).toEqual('/id');
    expect(refs.ensured.has('plain')).toBe(false);
    // The older set-shaped entry point stays consistent with it.
    expect([...containersReferencedInSource(root)].sort()).toEqual(['hidden', 'plain']);
  });

  it('records the ensured path literal even when the name is a literal', () => {
    const root = fixture({
      'lib/a.ts': "await ensureContainer('kudos', '/recipientMemberId');\n",
    });
    expect(containerReferences(root).ensured.get('kudos')).toBe('/recipientMemberId');
  });

  it('sees a container named only through the scoped accessor, as used but not raw', () => {
    // A swept file names its containers as `scope.query('players', …)`; the
    // classification canaries must keep seeing it, the ratchet must not.
    const root = fixture({
      'lib/a.ts': "const rows = await groupScope(g).query<Player>('players', { where: 'c.x = 1' });\nawait scope.read('skills', id, pk);\n",
    });
    const refs = containerReferences(root);
    expect([...refs.used.keys()].sort()).toEqual(['players', 'skills']);
    expect(refs.gotten.size).toBe(0);
  });

  it('tells raw getContainer access apart from a bare ensureContainer', () => {
    // The ratchet counts READS. A file that only provisions a container is
    // not touching its rows.
    const root = fixture({
      'lib/a.ts': "await ensureContainer('kudos', '/recipientMemberId');\n",
      'lib/b.ts': "export const c = getContainer('kudos');\n",
    });
    const refs = containerReferences(root);
    expect(refs.used.get('kudos')?.sort()).toEqual(['lib/a.ts', 'lib/b.ts']);
    expect(refs.gotten.get('kudos')).toEqual(['lib/b.ts']);
  });
});
