import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * A CLIENT FILE MUST NOT REACH NODE `crypto` OR THE COSMOS LAYER.
 *
 * `OfferedStringsCard` ('use client') imported one number, `MAX_OFFERED`, from
 * `lib/stringingStrings.ts`. That file imports `groupScope`, which imports
 * `containers` and `cosmos`, which import `crypto` — and Next answers a
 * `crypto` import in the browser graph by bundling `crypto-browserify`. Every
 * visitor downloaded it in the shared chunk, and its asn1 code calls `eval()`
 * at load, which the CSP blocks: the Issues panel showed "Content Security
 * Policy of your site blocks the use of `eval`" on every page.
 *
 * No test could see it: vitest runs in Node, where `crypto` is native. So this
 * walks the import graph from every `'use client'` file instead. Type-only
 * imports are skipped (erased at compile), as is `import('x').Type` in a type
 * position. A dynamic `import('x')` call still counts — it is a lazy chunk,
 * but the browser still downloads it.
 */
const ROOT = process.cwd();
const SCAN = ['app', 'components', 'lib'];
const FORBIDDEN_BARE = new Set(['crypto', 'node:crypto', '@azure/cosmos']);
const FORBIDDEN_FILES = new Set([join(ROOT, 'lib', 'cosmos.ts')]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return spec;
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

function runtimeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  const staticRe = /^\s*(?:import|export)\s+(?!type\s)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(staticRe)) {
    // `import { type A, type B } from` is erased just like `import type`.
    if (/^\{\s*(?:type\s+\w+\s*,?\s*)+\}$/.test(m[1].trim())) continue;
    specs.push(m[2]);
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]);
  // `import('x')` as a call, not `import('x').Type` in a type position.
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)(?!\s*\.)/g)) specs.push(m[1]);
  return specs;
}

const isClient = (f: string) =>
  /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*['"]use client['"]/.test(readFileSync(f, 'utf8'));

describe('client files stay off the server layer', () => {
  const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
  const clientFiles = files.filter(isClient);

  it('finds the client entry points', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
  });

  it('no client file reaches crypto, @azure/cosmos or lib/cosmos.ts', () => {
    const parent = new Map<string, string | null>();
    const queue = [...clientFiles];
    for (const f of clientFiles) parent.set(f, null);
    const offenders: string[] = [];

    const chain = (from: string, leaf: string) => {
      const steps = [leaf];
      for (let c: string | null | undefined = from; c; c = parent.get(c)) steps.push(relative(ROOT, c));
      return steps.reverse().join(' -> ');
    };

    while (queue.length) {
      const file = queue.shift()!;
      for (const spec of runtimeImports(file)) {
        const target = resolveSpec(file, spec);
        if (!target) continue;
        if (FORBIDDEN_BARE.has(target) || FORBIDDEN_FILES.has(target)) {
          offenders.push(chain(file, FORBIDDEN_BARE.has(target) ? target : relative(ROOT, target)));
          continue;
        }
        if (!target.startsWith('/') || parent.has(target)) continue;
        parent.set(target, file);
        queue.push(target);
      }
    }

    expect(
      offenders,
      'move the constant or helper the client needs into a module with no server imports',
    ).toEqual([]);
  });
});
