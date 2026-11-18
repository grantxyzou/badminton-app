import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postEvent } from '@/app/api/events/route';
import { POST as createGroup } from '@/app/api/groups/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { verifyLiveMemberAuth, verifyLiveAccountAuth } from '@/lib/auth';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  setupAdminPin,
  makeRequest,
  memberCookieValue,
} from './helpers';

/**
 * Claude Security, gap 1 of the 2026-11-17 scan: DENY BY DEFAULT. The member
 * check used to ask only "is the cookie signed and not signed out
 * everywhere?", so two people who are on no roster passed it as members of
 * the club their cookie names:
 *   - an account in no club (its cookie names BPM, the default), and
 *   - a member REMOVED from the club, still holding a 30-day cookie.
 * The member check now needs an active place on the roster; the few no-club
 * routes call the account check, each listed in account-check-coverage.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const BPM = 'bpm';
const events = () => (getStore()['events'] ?? []) as Array<{ memberId?: string }>;

const as = (name: string, id: string, extra: Record<string, string> = {}) => ({
  Cookie: `member_session=${memberCookieValue(name, id)}`,
  ...extra,
});
const tap = (name: string, id: string) =>
  postEvent(makeRequest('POST', 'http://x/api/events', { kind: 'rec_card_tap' }, as(name, id)));

describe('groups on', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env[FLAG] = 'true';
    seedGroup(BPM, { name: 'BPM Core' });
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  describe('an account in no club, its cookie naming BPM', () => {
    beforeEach(() => {
      seedMember('Stranger', { id: 'stranger' });
    });

    it('is not a member of BPM: it cannot write inside the club', async () => {
      expect((await tap('Stranger', 'stranger')).status).toBe(401);
      expect(events()).toHaveLength(0);
      const req = new NextRequest('http://x/', { headers: as('Stranger', 'stranger') });
      expect(await verifyLiveMemberAuth(req)).toBeNull();
    });

    it('is still an account: it reads as signed in and may create a club', async () => {
      const me = await (await authMe(makeRequest('GET', 'http://x/api/auth/me', undefined, as('Stranger', 'stranger')))).json();
      expect(me.signedIn).toBe(true);
      const res = await createGroup(makeRequest('POST', 'http://x/api/groups', { name: 'Six Feathers' }, as('Stranger', 'stranger')));
      expect(res.status).not.toBe(401);
      const req = new NextRequest('http://x/', { headers: as('Stranger', 'stranger') });
      expect((await verifyLiveAccountAuth(req))?.memberId).toBe('stranger');
    });
  });

  describe('a member removed from the club, with the cookie they had', () => {
    beforeEach(() => {
      seedMember('Lin', { id: 'lin' });
      seedMembership(BPM, 'lin', { name: 'Lin', status: 'removed', reserveName: false });
    });

    it('cannot write inside the club', async () => {
      expect((await tap('Lin', 'lin')).status).toBe(401);
      expect(events()).toHaveLength(0);
    });
  });

  it('a member on the roster writes as before', async () => {
    seedMember('Akane', { id: 'akane' });
    seedMembership(BPM, 'akane', { name: 'Akane' });
    expect((await tap('Akane', 'akane')).status).toBe(201);
    expect(events().map((e) => e.memberId)).toEqual(['akane']);
  });
});

describe('groups off', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('a removed (inactive) member cannot write inside the club', async () => {
    seedMember('Lin', { id: 'lin', active: false });
    expect((await tap('Lin', 'lin')).status).toBe(401);
  });
});
