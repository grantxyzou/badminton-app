import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The generated pictures can come from a storage container
 * (`docs/plans/asset-storage.md`). Unset, nothing changes: every URL is the
 * app's own, so the switch ships dark and rolling back is unsetting it.
 */

const saved = process.env.NEXT_PUBLIC_ASSET_BASE;
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_ASSET_BASE;
  else process.env.NEXT_PUBLIC_ASSET_BASE = saved;
  vi.resetModules();
});

async function urls() {
  vi.resetModules();
  const [{ racketSrc, racketHeadSrc }, { stringPackSrc }, { assetsCrossOrigin }] = await Promise.all([
    import('../lib/racketLook'),
    import('../lib/stringPackSrc'),
    import('../lib/assetUrl'),
  ]);
  return { racketSrc, racketHeadSrc, stringPackSrc, assetsCrossOrigin };
}

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
async function csp(): Promise<string> {
  // next.config.js reads the variable when it loads, so load it afresh.
  const path = require.resolve('../next.config.js');
  delete require.cache[path];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cfg = require(path) as { headers: () => Promise<Rule[]> };
  const rules = await cfg.headers();
  return rules.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
}

describe('where the racket and string pictures come from', () => {
  it('unset: the app serves them itself, exactly as before', async () => {
    delete process.env.NEXT_PUBLIC_ASSET_BASE;
    const u = await urls();
    expect(u.racketSrc('racket-li-ning-halbertec-9000')).toMatch(/^(\/bpm)?\/rackets\/racket-li-ning-halbertec-9000\.webp$/);
    expect(u.racketHeadSrc(null)).toMatch(/^(\/bpm)?\/rackets\/head\/_default\.webp$/);
    expect(u.stringPackSrc('string-yx-bg80')).toMatch(/^(\/bpm)?\/strings\/string-yx-bg80\.webp$/);
    expect(u.assetsCrossOrigin()).toBe(false);
  });

  it('set: every picture comes from the container, a trailing slash or not', async () => {
    process.env.NEXT_PUBLIC_ASSET_BASE = 'https://bpmassets.blob.core.windows.net/public/';
    const u = await urls();
    expect(u.racketSrc('racket-li-ning-halbertec-9000')).toBe('https://bpmassets.blob.core.windows.net/public/rackets/racket-li-ning-halbertec-9000.webp');
    expect(u.racketHeadSrc('racket-li-ning-halbertec-9000')).toBe('https://bpmassets.blob.core.windows.net/public/rackets/head/racket-li-ning-halbertec-9000.webp');
    expect(u.stringPackSrc('string-yx-bg80')).toBe('https://bpmassets.blob.core.windows.net/public/strings/string-yx-bg80.webp');
    expect(u.stringPackSrc('string-nobody-makes')).toBeNull();
    expect(u.assetsCrossOrigin()).toBe(true);
  });

  it('no other file builds a picture URL by hand', () => {
    for (const f of ['lib/racketLook.ts', 'lib/stringPackSrc.ts']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).not.toMatch(/NEXT_PUBLIC_BASE_PATH|\$\{BASE\}\/(rackets|strings)/);
    }
  });
});

describe('the CSP follows the switch', () => {
  it('unset: images from this origin and data: only', async () => {
    delete process.env.NEXT_PUBLIC_ASSET_BASE;
    expect(await csp()).toContain("img-src 'self' data:;");
  });

  it('set: that one origin is added, not the path and nothing else', async () => {
    process.env.NEXT_PUBLIC_ASSET_BASE = 'https://bpmassets.blob.core.windows.net/public';
    expect(await csp()).toContain("img-src 'self' data: https://bpmassets.blob.core.windows.net;");
  });
});

describe('a canvas drawing a racket picture can still export', () => {
  it('the share card asks for it with CORS', () => {
    const src = readFileSync(join(process.cwd(), 'components/stats/SetupShareSheet.tsx'), 'utf8');
    expect(src).toContain("img.crossOrigin = 'anonymous'");
  });
});
