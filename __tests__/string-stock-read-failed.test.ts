import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, setupAdminPin, makeAdminRequest, seedTestAdminMember } from './helpers';

/**
 * The stock summary's 503 names the read that failed. Four reads behind one
 * `Promise.all` answered production with a bare `read_failed` on 2026-10-10
 * and nothing — not the log, not the body — said which one.
 */
vi.mock('@/lib/stringingStrings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stringingStrings')>()),
  readOfferedStringsWithLinks: vi.fn(async () => null),
}));

const BASE = 'http://localhost:3000/api';

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('GET /api/stringing/stock when a read fails', () => {
  it('answers 503 read_failed and names the step', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('@/app/api/stringing/stock/route');
    const res = await GET(makeAdminRequest('GET', `${BASE}/stringing/stock`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed', step: 'offered' });
    quiet.mockRestore();
  });
});
