import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, seedSession, setupAdminPin, makeGetRequest, makeRequest, seedMember, memberCookieValue } from './helpers';
import { GET } from '@/app/api/sessions/locations/route';

/**
 * GET /api/sessions/locations — the advance form's venue and title chips.
 *
 * The two-club isolation case lives in group-isolation-sweep-2.test.ts; this
 * file holds the route's own contract: admin-only, newest first, deduplicated
 * after trimming, six of each at most, and a failed read is a 503 (an empty
 * 200 would read as "no venues yet").
 *
 * The NEWEST-FIRST order is the query's `ORDER BY c.id DESC`, which the mock
 * store does not apply (it returns rows in insertion order), so these cases
 * seed newest first and test what the route does with that order: the first
 * occurrence of a venue or title wins, and the first six are kept.
 */
const URL = 'http://localhost/api/sessions/locations';

type Body = { locations: Array<{ locationName: string; locationAddress: string }>; titles: string[] };

describe('GET /api/sessions/locations', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('refuses a signed-out caller with 401 and no body data', async () => {
    seedSession('session-2026-11-12', { locationName: 'Gym', locationAddress: '1 Main St' });
    const res = await GET(makeGetRequest(URL));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.locations).toBeUndefined();
    expect(body.titles).toBeUndefined();
  });

  it('refuses a signed-in member who is not an admin', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', URL, undefined, { Cookie: `member_session=${memberCookieValue('Lin')}` }));
    expect(res.status).toBe(401);
  });

  it('answers empty lists for a club with no sessions', async () => {
    const res = await GET(makeGetRequest(URL, true));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locations: [], titles: [] });
  });

  it('dedupes trimmed venues and titles, keeping first-seen order', async () => {
    seedSession('session-2026-11-12', { title: 'Holiday hit', locationName: 'Gym', locationAddress: '1 Main St' });
    seedSession('session-2026-11-05', { title: ' Thursday ', locationName: ' Gym ', locationAddress: '1 Main St ' });
    seedSession('session-2026-10-29', { title: 'Thursday', locationName: 'Old Gym', locationAddress: '9 Side St' });

    const res = await GET(makeGetRequest(URL, true));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    expect(body.locations).toEqual([
      { locationName: 'Gym', locationAddress: '1 Main St' },
      { locationName: 'Old Gym', locationAddress: '9 Side St' },
    ]);
    expect(body.titles).toEqual(['Holiday hit', 'Thursday']);
  });

  it('skips a session with no venue and no title, and keeps an address-only venue', async () => {
    seedSession('session-2026-11-12', { title: '', locationName: '', locationAddress: '' });
    seedSession('session-2026-11-05', { title: undefined, locationName: undefined, locationAddress: '5 Court Rd' });

    const body = (await (await GET(makeGetRequest(URL, true))).json()) as Body;
    expect(body.locations).toEqual([{ locationName: '', locationAddress: '5 Court Rd' }]);
    expect(body.titles).toEqual([]);
  });

  it('returns at most six venues and six titles, the first six seen', async () => {
    for (let d = 9; d >= 1; d--) {
      const day = String(d).padStart(2, '0');
      seedSession(`session-2026-10-${day}`, { title: `Title ${d}`, locationName: `Venue ${d}`, locationAddress: '' });
    }
    const body = (await (await GET(makeGetRequest(URL, true))).json()) as Body;
    expect(body.locations.map((l) => l.locationName)).toEqual(['Venue 9', 'Venue 8', 'Venue 7', 'Venue 6', 'Venue 5', 'Venue 4']);
    expect(body.titles).toEqual(['Title 9', 'Title 8', 'Title 7', 'Title 6', 'Title 5', 'Title 4']);
  });
});

describe('GET /api/sessions/locations — read failure', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    vi.resetModules();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock('@/lib/groupScope');
    error.mockRestore();
  });

  it('answers 503, not an empty 200', async () => {
    vi.doMock('@/lib/groupScope', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/groupScope')>();
      return { ...mod, groupScope: () => ({ query: async () => { throw new Error('cosmos down'); } }) };
    });
    const { GET: failingGet } = await import('@/app/api/sessions/locations/route');
    const res = await failingGet(makeGetRequest(URL, true));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.locations).toBeUndefined();
  });
});
