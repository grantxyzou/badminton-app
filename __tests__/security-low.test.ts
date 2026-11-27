import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as drillDone } from '@/app/api/stats/drills/done/route';
import { POST as ASK } from '@/app/api/members/access-request/route';
import { POST as CLAIM } from '@/app/api/members/access-request/claim/route';
import { PATCH as mePatch } from '@/app/api/members/me/route';
import { PATCH as gearPatch } from '@/app/api/equipment/gear/route';
import { GET as recommend } from '@/app/api/recommend/route';
import { DELETE as rosterDelete } from '@/app/api/groups/members/[memberId]/route';
import { PATCH as membersPatch, DELETE as membersDelete } from '@/app/api/members/route';
import { GET as slice0 } from '@/app/api/admin/slice0/route';
import { POST as migrateMemberId } from '@/app/api/admin/migrate-memberId/route';
import { GET as ledger } from '@/app/api/admin/ledger/route';
import { GET as ledgerEntries } from '@/app/api/admin/ledger/entries/route';
import { GET as expenses } from '@/app/api/admin/expenses/route';
import { GET as metrics } from '@/app/api/admin/metrics/route';
import { GET as aliases } from '@/app/api/aliases/route';
import { GET as birds } from '@/app/api/birds/route';
import { GET as sessionsList } from '@/app/api/sessions/route';
import { GET as sessionCosts } from '@/app/api/sessions/costs/route';
import { GET as sessionsRecent } from '@/app/api/sessions/recent/route';
import { GET as memberHistory } from '@/app/api/members/[id]/history/route';
import { GET as unpaid } from '@/app/api/players/unpaid/route';
import { GET as owedAudit } from '@/app/api/admin/owed-audit/route';
import { GET as stock } from '@/app/api/stringing/stock/route';
import { GET as earnings } from '@/app/api/stringing/earnings/route';
import { GET as jobs } from '@/app/api/stringing/jobs/route';
import { POST as mintReportsKey } from '@/app/api/admin/reports/key/route';
import { verifyRecoveryCode } from '@/lib/memberRecoveryCode';
import { hashPin } from '@/lib/recoveryHash';
import * as cosmos from '@/lib/cosmos';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { _resetCalibrationCache } from '@/lib/levelStore';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  seedAdminMember,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  adminCookieValue,
  ADMIN_MEMBER_ID,
  getTestAdminName,
} from './helpers';

/**
 * Claude Security scan, 2026-11-17: the LOW findings marked "fix now". One
 * block per finding, each written to fail against the code before the fix.
 */

const compares = { count: 0 };
vi.mock('@/lib/recoveryHash', async (orig) => {
  const mod = await orig<typeof import('@/lib/recoveryHash')>();
  return {
    ...mod,
    verifyPin: async (pin: string, hash: string) => {
      compares.count++;
      return mod.verifyPin(pin, hash);
    },
  };
});

const GROUPS = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const STRINGING = 'NEXT_PUBLIC_FLAG_STRINGING';
const BPM = 'bpm';

const asMember = (name: string, id: string) => ({ Cookie: `member_session=${memberCookieValue(name, id)}` });

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  compares.count = 0;
});
afterEach(() => {
  delete process.env[GROUPS];
  delete process.env[STRINGING];
  delete process.env.OPERATOR_MEMBER_IDS;
});

describe('F13: a drill tick lands on the cookie’s person, never on its name', () => {
  beforeEach(() => {
    process.env[GROUPS] = 'true';
    seedGroup(BPM, { name: 'BPM Core' });
  });

  it('an account in no club, named like a member, writes nothing of theirs', async () => {
    seedMember('Grant Zou', { id: 'grant' });
    seedMembership(BPM, 'grant', { name: 'Grant' });
    seedMember('Grant', { id: 'stranger' });
    const res = await drillDone(makeRequest('POST', 'http://x/api/stats/drills/done', { drillId: 'd1', done: true }, asMember('Grant', 'stranger')));
    expect(res.status).toBe(401);
    const docs = (getStore()['drillCompletions'] ?? []) as Array<{ memberId: string }>;
    expect(docs.some((d) => d.memberId === 'grant')).toBe(false);
  });

  it('a member whose account name differs from their roster name writes their own record', async () => {
    seedMember('Lin Dan', { id: 'lin' });
    seedMembership(BPM, 'lin', { name: 'Lin' });
    const res = await drillDone(makeRequest('POST', 'http://x/api/stats/drills/done', { drillId: 'd1', done: true }, asMember('Lin Dan', 'lin')));
    expect(res.status).toBe(200);
    const docs = (getStore()['drillCompletions'] ?? []) as Array<{ memberId: string; done: string[] }>;
    expect(docs.find((d) => d.memberId === 'lin')?.done).toEqual(['d1']);
  });
});

describe('F14: a raw secret read out of a seal says nothing about a name', () => {
  /** The seal is signed, not encrypted: its first segment is readable JSON. */
  function rawFrom(seal: string): string {
    const envelope = JSON.parse(Buffer.from(seal.split('.')[0], 'base64url').toString('utf8'));
    return envelope.v.s;
  }
  const poll = async (name: string, secret: string) =>
    (await (await CLAIM(makeRequest('POST', 'http://x/claim', { name, secret }))).json()).status;

  it('a real member and a name nobody holds answer the same', async () => {
    seedMember('Lin', { id: 'lin' });
    const lin = await (await ASK(makeRequest('POST', 'http://x/ask', { name: 'Lin' }))).json();
    const nobody = await (await ASK(makeRequest('POST', 'http://x/ask', { name: 'Nobody Here' }))).json();
    expect(await poll('Lin', rawFrom(lin.secret))).toBe(await poll('Nobody Here', rawFrom(nobody.secret)));
  });
});

describe('F15: a signed-out PIN change is told nothing about the account', () => {
  beforeEach(async () => {
    seedMember('Riley', { id: 'riley', pinHash: await hashPin('4827') });
    seedMember('Sam', { id: 'sam' });
  });
  const answer = async (body: Record<string, unknown>) => {
    const res = await mePatch(makeRequest('PATCH', 'http://x/api/members/me', body));
    return { status: res.status, body: await res.json() };
  };

  it('no current PIN: nobody, a member with a PIN and one without get one answer', async () => {
    const nobody = await answer({ name: 'Nobody', newPin: '5392' });
    expect(await answer({ name: 'Riley', newPin: '5392' })).toEqual(nobody);
    expect(await answer({ name: 'Sam', newPin: '5392' })).toEqual(nobody);
    expect(nobody.status).toBe(401);
  });

  it('a current PIN: nobody and a member with no PIN get the wrong-PIN answer', async () => {
    const nobody = await answer({ name: 'Nobody', currentPin: '1111', newPin: '5392' });
    expect(await answer({ name: 'Sam', currentPin: '1111', newPin: '5392' })).toEqual(nobody);
    expect(await answer({ name: 'Riley', currentPin: '1111', newPin: '5392' })).toEqual(nobody);
  });

  it('every miss costs one scrypt', async () => {
    await answer({ name: 'Nobody', newPin: '5392' });
    expect(compares.count).toBe(1);
    compares.count = 0;
    await answer({ name: 'Sam', newPin: '5392' });
    expect(compares.count).toBe(1);
  });

  it('the privacy, picture and email branches answer a stranger the same for any name', async () => {
    for (const extra of [{ statsPrivacy: { clubComparison: true } }, { avatar: null }, { contactEmail: 'a@b.co' }]) {
      const nobody = await answer({ name: 'Nobody', ...extra });
      expect(await answer({ name: 'Sam', ...extra })).toEqual(nobody);
    }
  });

  it('the member’s own phone is still told a current PIN is needed', async () => {
    const res = await mePatch(makeRequest('PATCH', 'http://x/api/members/me', { name: 'Riley', newPin: '5392' }, asMember('Riley', 'riley')));
    expect((await res.json()).error).toBe('current_pin_required');
  });
});

describe('F16: an admin’s gear write does not echo the arm answers', () => {
  beforeEach(async () => {
    seedMember('Lin', { id: 'lin' });
    seedAdminMember();
    await ensureContainer('playerGear', '/memberId');
    await getContainer('playerGear').items.upsert({
      id: 'gear-lin', memberId: 'lin', items: [], fitArmComfort: 'often_sore', fitSoreness: 'shoulder',
    });
  });

  it('an admin’s PATCH comes back without them', async () => {
    const res = await gearPatch(makeAdminRequest('PATCH', 'http://x/api/equipment/gear', { name: 'Lin', playFormat: 'doubles' }));
    expect(res.status).toBe(200);
    const { gear } = await res.json();
    expect(gear.playFormat).toBe('doubles');
    expect(gear).not.toHaveProperty('fitArmComfort');
    expect(gear).not.toHaveProperty('fitSoreness');
  });

  it('the owner’s PATCH still carries them', async () => {
    const res = await gearPatch(makeRequest('PATCH', 'http://x/api/equipment/gear', { name: 'Lin', playFormat: 'doubles' }, asMember('Lin', 'lin')));
    expect((await res.json()).gear.fitArmComfort).toBe('often_sore');
  });
});

describe('F17: a recovery-code check costs one scrypt whether or not a code is waiting', () => {
  it('no code, an expired one and a tried-out one each compare once', async () => {
    for (const stored of [undefined, { hash: 'x', expiresAt: Date.now() - 1 }, { hash: 'x', expiresAt: Date.now() + 60_000, attempts: 99 }]) {
      compares.count = 0;
      expect(await verifyRecoveryCode(stored, '123456')).toBe(false);
      expect(compares.count).toBe(1);
    }
  });
});

describe('F20: taking an admin off the roster is an organiser’s call', () => {
  beforeEach(() => {
    process.env[GROUPS] = 'true';
    seedGroup(BPM, { name: 'BPM Core' });
    seedAdminMember();
    seedMember('Viktor', { id: 'viktor' });
    seedMembership(BPM, 'viktor', { name: 'Viktor', role: 'admin' });
    seedMember('Akane', { id: 'akane' });
    seedMembership(BPM, 'akane', { name: 'Akane' });
  });
  const asAdmin = () => ({ Cookie: `admin_session=${adminCookieValue({ groupId: BPM })}` });
  const viktor = () =>
    (getStore()['memberships'] as Array<{ id: string; status: string }>).find((m) => m.id === `${BPM}:viktor`)!;

  describe('as a plain admin', () => {
    beforeEach(() => {
      seedMembership(BPM, ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'admin' });
    });

    it('DELETE /api/groups/members/[id] refuses', async () => {
      const res = await rosterDelete(makeRequest('DELETE', 'http://x/api/groups/members/viktor', undefined, asAdmin()), { params: Promise.resolve({ memberId: 'viktor' }) });
      expect(res.status).toBe(403);
      expect(viktor().status).toBe('active');
    });

    it('PATCH /api/members { active: false } refuses', async () => {
      const res = await membersPatch(makeRequest('PATCH', 'http://x/api/members', { id: 'viktor', active: false }, asAdmin()));
      expect(res.status).toBe(403);
      expect(viktor().status).toBe('active');
    });

    it('DELETE /api/members refuses', async () => {
      const res = await membersDelete(makeRequest('DELETE', 'http://x/api/members', { id: 'viktor' }, asAdmin()));
      expect(res.status).toBe(403);
      expect(viktor().status).toBe('active');
    });

    it('still removes a player', async () => {
      const res = await rosterDelete(makeRequest('DELETE', 'http://x/api/groups/members/akane', undefined, asAdmin()), { params: Promise.resolve({ memberId: 'akane' }) });
      expect(res.status).toBe(200);
    });
  });

  it('an organiser removes an admin', async () => {
    seedMembership(BPM, ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
    const res = await rosterDelete(makeRequest('DELETE', 'http://x/api/groups/members/viktor', undefined, asAdmin()), { params: Promise.resolve({ memberId: 'viktor' }) });
    expect(res.status).toBe(200);
  });
});

describe('F21: a pick tally keyed "__proto__" stays in its own table', () => {
  const POLLUTED = ['added', 'tried', 'up', 'down', 'ratedUp', 'ratedDown', 'served', 'servedMembers'];
  afterEach(() => {
    for (const k of POLLUTED) delete (Object.prototype as Record<string, unknown>)[k];
  });

  it('GET /api/admin/slice0 leaves Object.prototype alone', async () => {
    seedAdminMember();
    const at = '2026-09-10T00:00:00Z';
    const store = getStore();
    store['events'] = ['pick_served', 'pick_added', 'pick_tried', 'pick_rated'].map((kind, i) => ({
      id: `p${i}`, memberId: 'm', name: 'm', kind, at, catalogId: '__proto__', engineVersion: '__proto__', rating: 'up',
    }));
    const res = await slice0(makeAdminRequest('GET', 'http://x/api/admin/slice0?since=2026-06-13'));
    expect(res.status).toBe(200);
    expect(({} as Record<string, unknown>).added).toBeUndefined();
    expect(({} as Record<string, unknown>).served).toBeUndefined();
  });
});

describe('F22, F26: deployment-wide powers are the operator’s', () => {
  beforeEach(() => {
    process.env.OPERATOR_MEMBER_IDS = 'someone-else';
    seedAdminMember();
  });

  it('POST /api/admin/migrate-memberId refuses a club admin', async () => {
    const res = await migrateMemberId(makeAdminRequest('POST', 'http://x/api/admin/migrate-memberId', { dryRun: true }));
    expect(res.status).toBe(403);
  });

  it('POST /api/admin/reports/key will not mint BPM’s key for a club admin', async () => {
    const res = await mintReportsKey(makeAdminRequest('POST', 'http://x/api/admin/reports/key'));
    expect(res.status).toBe(403);
  });

  it('the operator still mints it', async () => {
    process.env.OPERATOR_MEMBER_IDS = ADMIN_MEMBER_ID;
    const res = await mintReportsKey(makeAdminRequest('POST', 'http://x/api/admin/reports/key'));
    expect(res.status).toBe(200);
  });
});

/** Each read as the test admin's cookie asks it; `member-lin` is the history's subject. */
const MONEY_READS: [string, () => Promise<Response>][] = [
  ['admin/ledger/entries', () => ledgerEntries(makeAdminRequest('GET', 'http://x/api/admin/ledger/entries'))],
  ['admin/expenses', () => expenses(makeAdminRequest('GET', 'http://x/api/admin/expenses'))],
  ['admin/metrics', () => metrics(makeAdminRequest('GET', 'http://x/api/admin/metrics'))],
  ['aliases', () => aliases(makeAdminRequest('GET', 'http://x/api/aliases'))],
  ['birds', () => birds(makeAdminRequest('GET', 'http://x/api/birds'))],
  ['sessions', () => sessionsList(makeAdminRequest('GET', 'http://x/api/sessions'))],
  ['sessions/costs', () => sessionCosts(makeAdminRequest('GET', 'http://x/api/sessions/costs'))],
  ['sessions/recent', () => sessionsRecent(makeAdminRequest('GET', 'http://x/api/sessions/recent'))],
  ['members/[id]/history', () => memberHistory(makeAdminRequest('GET', 'http://x/api/members/member-lin/history'), { params: Promise.resolve({ id: 'member-lin' }) })],
];

/** The admin arm of the balance read: the admin cookie alone, asking about Lin. */
const othersBalance = () => unpaid(makeAdminRequest('GET', 'http://x/api/players/unpaid?name=Lin') as NextRequest);

describe('F23, F25: money and cost reads re-check the admin', () => {
  beforeEach(() => {
    process.env[STRINGING] = 'true';
    seedAdminMember({ role: 'member' }); // demoted since the cookie was minted
  });

  it('GET /api/admin/ledger', async () => {
    expect((await ledger(makeAdminRequest('GET', 'http://x/api/admin/ledger') as NextRequest)).status).toBe(401);
  });
  it('GET /api/admin/owed-audit', async () => {
    expect((await owedAudit(makeAdminRequest('GET', 'http://x/api/admin/owed-audit?name=Lin'))).status).toBe(401);
  });
  // The same rule on the reads the scan's fixes left on the cookie-only check
  // (found 2026-11-26): each names money, a cost, or the name someone banks under.
  it.each(MONEY_READS)('GET /api/%s', async (_path, read) => {
    expect((await read()).status).toBe(401);
  });
  // The admin arm of the owner-or-admin balance read: what a named member owes.
  it('GET /api/players/unpaid, asked about someone else', async () => {
    seedMember('Lin', { id: 'member-lin' });
    expect((await othersBalance()).status).toBe(403);
  });
  it('GET /api/stringing/stock', async () => {
    expect((await stock(makeAdminRequest('GET', 'http://x/api/stringing/stock'))).status).toBe(401);
  });
  // The same rule, found on the earnings read on 2026-11-26: it is the club's
  // money, and it shipped a day after F25 on the cookie-only check.
  it('GET /api/stringing/earnings', async () => {
    expect((await earnings(makeAdminRequest('GET', 'http://x/api/stringing/earnings'))).status).toBe(401);
  });
});

describe('the same reads still answer an admin who is one', () => {
  // The other half of the 401s above: without it they would pass on a route
  // that refused everybody.
  beforeEach(() => {
    seedAdminMember();
    seedMember('Lin', { id: 'member-lin' });
  });

  it.each(MONEY_READS)('GET /api/%s', async (_path, read) => {
    expect((await read()).status).toBe(200);
  });
  it('GET /api/players/unpaid, asked about someone else', async () => {
    expect((await othersBalance()).status).toBe(200);
  });

  it.each(MONEY_READS)('GET /api/%s refuses a cookie minted before "Sign out everywhere"', async (_path, read) => {
    seedAdminMember({ sessionsNotBefore: new Date(Date.now() + 60_000).toISOString() });
    expect((await read()).status).toBe(401);
  });
  it('GET /api/players/unpaid refuses that cookie too', async () => {
    seedAdminMember({ sessionsNotBefore: new Date(Date.now() + 60_000).toISOString() });
    expect((await othersBalance()).status).toBe(403);
  });

  // The check fails CLOSED: with the whole store down it cannot re-read the
  // admin, so it answers 401, never a 200. (Each route's own 503 is tested
  // with `members` up, where the request reaches the read.)
  it.each(MONEY_READS)('GET /api/%s answers 401, not a 200, when the admin cannot be re-read', async (_path, read) => {
    const down = vi.spyOn(cosmos, 'getContainer').mockImplementation(() => { throw new Error('cosmos down'); });
    try {
      expect((await read()).status).toBe(401);
    } finally {
      down.mockRestore();
    }
  });
});

describe('and with groups on, the rank is the membership’s in the club the cookie names', () => {
  // Production runs with groups on, where `Member.role` is not what admits an
  // admin: the membership is. The cases above run the rollback branch.
  const asRank = (role: 'member' | 'admin' | 'owner') => {
    process.env[GROUPS] = 'true';
    seedGroup(BPM);
    seedAdminMember(); // still `role: 'admin'` on the account: the stale copy
    seedMembership(BPM, ADMIN_MEMBER_ID, { name: getTestAdminName(), role });
    seedMember('Lin', { id: 'member-lin' });
    seedMembership(BPM, 'member-lin', { name: 'Lin' });
  };

  it.each(MONEY_READS)('GET /api/%s refuses an admin demoted to player', async (_path, read) => {
    asRank('member');
    expect((await read()).status).toBe(401);
  });
  it.each(MONEY_READS)('GET /api/%s answers an admin', async (_path, read) => {
    asRank('admin');
    expect((await read()).status).toBe(200);
  });
  it('GET /api/players/unpaid, asked about someone else, follows the same rank', async () => {
    asRank('member');
    expect((await othersBalance()).status).toBe(403);
    resetMockStore();
    setupAdminPin();
    asRank('owner');
    expect((await othersBalance()).status).toBe(200);
  });
});

describe('F24: the stringer bench honours "Sign out everywhere"', () => {
  it('a cookie minted before the cut-off reads nothing', async () => {
    process.env[STRINGING] = 'true';
    seedMember('Kento', { id: 'kento', canString: true, sessionsNotBefore: new Date().toISOString() });
    const res = await jobs(makeRequest('GET', 'http://x/api/stringing/jobs?view=stringer', undefined, asMember('Kento', 'kento')));
    expect(res.status).toBe(401);
  });
});

describe('F29: a recommendation asked on a member’s behalf ignores their arm answers', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    _resetCalibrationCache();
    setupAdminPin();
    seedMember('Lin', { id: 'member-lin' });
    seedAdminMember();
    await ensureContainer('playerGear', '/memberId');
    await getContainer('playerGear').items.upsert({
      id: 'gear-member-lin', memberId: 'member-lin', updatedAt: '2026-09-01',
      items: [{ id: 'i1', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' }],
      activeRacketId: 'i1', fitGoal: 'happy', fitSwing: 'fast', fitArmComfort: 'often_sore',
    });
  });

  it('the owner sees the sore-arm warning; an admin does not', async () => {
    const url = 'http://x/api/recommend?name=Lin&category=racket';
    const own = await (await recommend(makeRequest('GET', url, undefined, asMember('Lin', 'member-lin')))).json();
    expect(JSON.stringify(own.warningKeys)).toContain('SoreArm');
    const admin = await (await recommend(makeAdminRequest('GET', url))).json();
    expect(admin.item).toBeTruthy();
    expect(JSON.stringify(admin.warningKeys ?? [])).not.toContain('SoreArm');
  });
});
