import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * THE WEB BUNDLE MUST NOT PAY FOR THE NATIVE SHELL.
 *
 * Every `@capacitor/*` and `@capacitor-firebase/*` package is loaded with a
 * dynamic `import()` INSIDE an `isNative()` branch, so a browser or PWA user
 * downloads only an unloaded chunk reference. A static `import … from
 * '@capacitor/…'` at the top of any app file would pull the plugin and its
 * bridge shim into the shared graph for everyone.
 *
 * `lib/native.ts` itself imports nothing — it reads `window.Capacitor`.
 */
const ROOTS = ['app', 'components', 'lib'];
const STATIC_IMPORT = /^\s*import\s[^;]*?\sfrom\s+['"]@capacitor(?:-firebase)?\//m;
const STATIC_REQUIRE = /require\(\s*['"]@capacitor(?:-firebase)?\//;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('native imports stay dynamic', () => {
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r))).filter((f) =>
    /\.(ts|tsx)$/.test(f),
  );

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no app file statically imports a Capacitor package', () => {
    const offenders = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return STATIC_IMPORT.test(src) || STATIC_REQUIRE.test(src);
    });
    expect(
      offenders.map((f) => relative(process.cwd(), f)),
      'use `await import(\'@capacitor/…\')` inside an isNative() branch',
    ).toEqual([]);
  });

  it('lib/native.ts imports nothing at all', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'native.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/require\(/);
  });
});
