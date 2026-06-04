import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { GET as getPlayers } from '@/app/api/players/route';
import { GET as getSkills } from '@/app/api/skills/route';
import { GET as getReleases } from '@/app/api/releases/route';
import { GET as getAliases } from '@/app/api/aliases/route';
import { GET as getCosts } from '@/app/api/sessions/costs/route';
import { NextRequest } from 'next/server';
import { resetMockStore, seedPointer, seedSession, setupAdminPin, makeGetRequest } from './helpers';

/**
 * Audit remediation (silent-failure cluster): a data-store failure on a read
 * route must surface as a non-2xx error, NOT a confident 200 + empty payload.
 * The "lying empty state" — returning `[]` on a Cosmos throw — is exactly how
 * the v1.3 outage masked a broken backend (CLAUDE.md). Clients can only render
 * "couldn't load" if the server tells the truth about the failure.
 */
function getReq(url: string): NextRequest {
  return new NextRequest(url, { headers: { 'X-Client-IP': 'load-err-test' } });
}

describe('read routes surface load failures instead of a lying empty state', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    seedPointer('session-2026-01-01');
    seedSession('session-2026-01-01');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/players returns 503 when the players query throws (not 200 + [])', async () => {
    // getActiveSessionId uses cosmos' internal container ref (still works);
    // the route's getContainer('players') export call is what we break.
    vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
      throw new Error('cosmos down');
    });
    const res = await getPlayers(getReq('http://localhost/api/players'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('GET /api/skills returns 503 when the skills query throws (not 200 + empty)', async () => {
    vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
      throw new Error('cosmos down');
    });
    const res = await getSkills(makeGetRequest('http://localhost/api/skills', true));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  // Audit-tail deferred items: the three lower-value GETs that WS#1 skipped
  // (still returned 200 + empty on failure). Same rule applies — a backend
  // throw must not masquerade as "no data".
  it('GET /api/releases returns 503 when the query throws (not 200 + [])', async () => {
    vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
      throw new Error('cosmos down');
    });
    const res = await getReleases(getReq('http://localhost/api/releases'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('GET /api/aliases returns 503 when the query throws (not 200 + [])', async () => {
    vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
      throw new Error('cosmos down');
    });
    const res = await getAliases(makeGetRequest('http://localhost/api/aliases', true));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('GET /api/sessions/costs returns 503 when the query throws (not 200 + empty)', async () => {
    vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
      throw new Error('cosmos down');
    });
    const res = await getCosts(makeGetRequest('http://localhost/api/sessions/costs', true));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
