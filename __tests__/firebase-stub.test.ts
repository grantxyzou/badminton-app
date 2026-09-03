import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `lib/stubs/firebase-messaging.js` replaces `firebase/messaging` in the web
 * build (next.config.js `turbopack.resolveAlias`). If the plugin's web
 * implementation starts importing a name the stub does not export, the web
 * build 500s again — which is exactly how this was found the first time, on
 * `npm run dev:next:mock`, after every test was green.
 */
const PLUGIN_WEB = join(process.cwd(), 'node_modules', '@capacitor-firebase', 'messaging', 'dist', 'esm', 'web.js');
const STUB = join(process.cwd(), 'lib', 'stubs', 'firebase-messaging.js');

function importedNames(src: string): string[] {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*['"]firebase\/messaging['"]/);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.trim().split(/\s+as\s+/)[0]!.trim())
    .filter(Boolean);
}

describe('firebase/messaging stub', () => {
  it('exports every name the plugin\'s web implementation imports', () => {
    const wanted = importedNames(readFileSync(PLUGIN_WEB, 'utf8'));
    expect(wanted.length).toBeGreaterThan(0);
    const stub = readFileSync(STUB, 'utf8');
    for (const name of wanted) {
      expect(stub, `stub is missing export "${name}"`).toMatch(new RegExp(`export const ${name}\\b`));
    }
  });

  it('is wired into next.config.js', () => {
    const cfg = readFileSync(join(process.cwd(), 'next.config.js'), 'utf8');
    expect(cfg).toMatch(/'firebase\/messaging':\s*'\.\/lib\/stubs\/firebase-messaging\.js'/);
  });

  it('firebase is NOT a dependency — the stub is the point', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.firebase).toBeUndefined();
    expect(pkg.devDependencies?.firebase).toBeUndefined();
  });
});
