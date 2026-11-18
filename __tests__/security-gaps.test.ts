import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postEvent } from '@/app/api/events/route';
import { POST as createGroup } from '@/app/api/groups/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import { POST as recover } from '@/app/api/players/recover/route';
import { POST as adminLogin } from '@/app/api/admin/route';
import { PATCH as mePatch } from '@/app/api/members/me/route';
import { POST as codeVerify } from '@/app/api/auth/email-code/verify/route';
import { POST as setPassword } from '@/app/api/auth/password/route';
import { verifyLiveMemberAuth, verifyLiveAccountAuth } from '@/lib/auth';
import { hashPin } from '@/lib/recoveryHash';
import { mailboxIsProven, GRANDFATHERED_BEFORE } from '@/lib/emailProof';
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

const pads = { count: 0 };
vi.mock('@/lib/accountPad', () => ({
  PAD_ROUND_TRIPS: 3,
  padMissingAccount: async () => {
    pads.count++;
  },
}));

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

  it('an account in no club cannot tell a member’s name from a stranger’s (members/me)', async () => {
    seedMember('Stranger', { id: 'stranger' });
    seedMember('Lin', { id: 'lin' });
    seedMembership(BPM, 'lin', { name: 'Lin' });
    const ask = async (name: string) => {
      const res = await mePatch(makeRequest('PATCH', 'http://x/api/members/me', { name, statsPrivacy: { clubComparison: true } }, as('Stranger', 'stranger')));
      return { status: res.status, body: await res.json() };
    };
    expect(await ask('Nobody Here')).toEqual(await ask('Lin'));
  });

  it('setting a password on a NEW address drops the old mailbox proof (gap 2 review)', async () => {
    // A Google account (mailbox proven at sign-up) puts a password on Jenny's
    // address. Jenny's first code there must still take the account back.
    seedMember('Grifter', { id: 'grifter', email: 'grifter@example.com', emailVerified: true, mailboxProven: true });
    seedMembership(BPM, 'grifter', { name: 'Grifter' });
    const res = await setPassword(makeRequest('POST', 'http://x/api/auth/password', { email: 'jenny@example.com', password: 'a long enough password 1' }, as('Grifter', 'grifter')));
    expect(res.status).toBe(200);
    const doc = (getStore()['members'] as Array<{ id: string; mailboxProven?: boolean }>).find((m) => m.id === 'grifter')!;
    expect(doc.mailboxProven).toBe(false);
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

/**
 * Gap 3 (Grant: "pad it"). A wrong guess against a real account reads it and
 * writes its counter; a name nobody holds now pays comparable database work
 * (`padMissingAccount`), so the slower answer no longer names the member.
 */
describe('gap 3: a name nobody holds pays the database work a real miss does', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    pads.count = 0;
  });

  it('PIN sign-in (players/recover)', async () => {
    await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Nobody Here', pin: '5839' }));
    expect(pads.count).toBe(1);
  });

  it('recovery code (players/recover)', async () => {
    await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Nobody Here', code: '123456' }));
    expect(pads.count).toBe(1);
  });

  it('admin sign-in', async () => {
    await adminLogin(makeRequest('POST', 'http://x/api/admin', { name: 'Nobody Here', pin: '5839' }));
    expect(pads.count).toBe(1);
  });

  it('a signed-out PIN change with a current PIN', async () => {
    await mePatch(makeRequest('PATCH', 'http://x/api/members/me', { name: 'Nobody Here', currentPin: '1111', newPin: '5392' }));
    expect(pads.count).toBe(1);
  });

  it('an email code for an address nobody holds', async () => {
    await codeVerify(makeRequest('POST', 'http://x/api/auth/email-code/verify', { email: 'nobody@example.com', code: '123456' }));
    expect(pads.count).toBe(1);
  });

  it('a real member’s wrong PIN does its own work, and pays no pad', async () => {
    seedMember('Lin', { id: 'lin', pinHash: await hashPin('2468') });
    await recover(makeRequest('POST', 'http://x/api/players/recover', { name: 'Lin', pin: '5839' }));
    expect(pads.count).toBe(0);
  });
});

describe('gap 2: existing accounts are grandfathered (Grant, 2026-11-18)', () => {
  const before = '2026-10-01T00:00:00.000Z';
  const after = new Date(Date.parse(GRANDFATHERED_BEFORE) + 60_000).toISOString();

  it('an old, confirmed account counts as proven', () => {
    expect(mailboxIsProven({ emailVerified: true, createdAt: before })).toBe(true);
    expect(mailboxIsProven({ emailVerified: true })).toBe(true); // no createdAt: predates it
  });

  it('a new account confirmed only by link does not', () => {
    expect(mailboxIsProven({ emailVerified: true, createdAt: after })).toBe(false);
  });

  it('an old account never confirmed does not', () => {
    expect(mailboxIsProven({ emailVerified: false, createdAt: before })).toBe(false);
  });

  it('an explicit false (the address changed) is never grandfathered', () => {
    expect(mailboxIsProven({ mailboxProven: false, emailVerified: true, createdAt: before })).toBe(false);
  });
});
