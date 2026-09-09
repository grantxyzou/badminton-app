import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { resolveGroupId, resolveGroupIdFromCookieHeader, noActiveSession } from '@/lib/groupContext';
import { BPM_GROUP_ID } from '@/lib/groupScope';
import { makeRequest, setupAdminPin } from './helpers';

const originalEnv = { ...process.env };

describe('noActiveSession', () => {
  it('is a 404 with the one error code every route shares', async () => {
    const res = noActiveSession();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_active_session' });
  });
});

/**
 * Phase 1 contract: every request resolves to BPM. The cookie claim that
 * Phase 2 adds is IGNORED while the flag is off — a forged claim must not be
 * able to move a request into another group on a deployment that has not
 * turned groups on.
 */
describe('resolveGroupId', () => {
  beforeEach(() => {
    setupAdminPin();
    delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('is BPM for a request with no cookies', () => {
    expect(resolveGroupId(makeRequest('GET', 'http://localhost/api/session'))).toBe(BPM_GROUP_ID);
  });

  it('is BPM even when a cookie carries a groupId claim, while the flag is off', () => {
    const req = makeRequest('GET', 'http://localhost/api/session', undefined, {
      Cookie: 'member_session=forged-claim-for-a1b2c3',
    });
    expect(resolveGroupId(req)).toBe(BPM_GROUP_ID);
  });

  it('has a server-component twin that takes the raw cookie header', () => {
    expect(resolveGroupIdFromCookieHeader(null)).toBe(BPM_GROUP_ID);
    expect(resolveGroupIdFromCookieHeader('member_session=whatever')).toBe(BPM_GROUP_ID);
  });
});
