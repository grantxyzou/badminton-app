import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GET } from '../app/api/health/route';

/**
 * App Service's health-check probe. It must answer 200 with no cookie, and it
 * must not depend on Cosmos: Azure replaces an instance that fails it for an
 * hour, which would recycle a healthy server every time the database blinked.
 */
describe('GET /api/health', () => {
  it('answers 200 with no cookie, uncached', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('reads nothing: no database, no auth, no rate limit', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/health/route.ts'), 'utf8');
    for (const banned of ['@/lib/cosmos', 'getContainer', 'groupScope', 'requireMember', 'checkRateLimit']) {
      expect(src, banned).not.toContain(banned);
    }
  });
});
