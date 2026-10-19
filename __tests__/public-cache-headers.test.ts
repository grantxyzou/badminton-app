import { describe, it, expect, afterEach } from 'vitest';

/**
 * public/ images and icons get a one-day cache (next.config.js). Next serves
 * public/ with `max-age=0` by default, so every launch re-checked every racket
 * picture and icon with a round trip each (performance audit, 2026-10-19).
 *
 * The names are not content-hashed, so the cache is a DAY, never `immutable`,
 * and the files that must always be fresh — the service worker, the manifest,
 * the payments script, the changelog — get no rule at all.
 */

type Rule = { source: string; headers: Array<{ key: string; value: string }> };

async function rules(): Promise<Rule[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cfg = require('../next.config.js') as { headers: () => Promise<Rule[]> };
  return cfg.headers();
}

const cacheFor = (all: Rule[], source: string) =>
  all.find((r) => r.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
});

describe('public/ cache headers', () => {
  it('caches rackets, brand art and icons for a day in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const all = await rules();
    for (const source of ['/rackets/:path*', '/brand/:path*', '/icons/:path*']) {
      const value = cacheFor(all, source);
      expect(value).toBe('public, max-age=86400, stale-while-revalidate=604800');
      expect(value).not.toMatch(/immutable/);
    }
  });

  it('caches nothing in dev, where files change under the same name', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    const all = await rules();
    expect(cacheFor(all, '/rackets/:path*')).toMatch(/no-store/);
  });

  it('leaves the files that must stay fresh alone', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const all = await rules();
    const cached = all.filter((r) => r.headers.some((h) => h.key === 'Cache-Control' && /max-age=[1-9]/.test(h.value)));
    for (const r of cached) {
      expect(r.source).not.toMatch(/sw\.js|manifest|payments|changelog|^\/:path\*$/);
    }
  });
});
