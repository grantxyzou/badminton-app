import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedGroup,
  seedPointer,
  seedSession,
  seedPlayer,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET as settingsGet, PATCH as settingsPatch } from '@/app/api/admin/settings/route';
import { GET as unpaidGet } from '@/app/api/players/unpaid/route';
import { GET as historyGet } from '@/app/api/sessions/history/route';

/**
 * ONE address. The admin's "E-transfer recipient" screen and the address a
 * member reads under their balance on Home must be the same value.
 *
 * Grant, 2026-10-12, two screenshots side by side: Home said "E-transfer to
 * admin@motioncraft-bpm.com" while the admin screen said grantxyzou@gmail.com
 * — "The email are not connected". With groups OFF the screen read and wrote
 * the admin's Member doc only, while Home's `clubPayTo` read the group doc
 * first, and BPM's group doc has existed since the 2026-09-10 backfill. So
 * the copy members saw was frozen at that day's value and no save reached it.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
const ACTIVE = 'session-2026-06-08';
const A = { name: 'Club', email: 'club@example.com' };
const B = { name: 'Grant', email: 'grant@example.com' };
const C = { name: 'New', email: 'new@example.com' };

function adminMember() {
  return (getStore()['members'] as { id: string; eTransferRecipient?: unknown }[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
}

async function screen() {
  const res = await settingsGet(makeGetRequest('http://x/api/admin/settings', true));
  return (await res.json()).eTransferRecipient;
}

async function home() {
  const res = await unpaidGet(
    makeRequest('GET', 'http://x/api/players/unpaid?name=Lin', undefined, { Cookie: `member_session=${memberCookieValue('Lin')}` }),
  );
  return (await res.json()).payTo;
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  delete process.env[FLAG];
  seedPointer(ACTIVE);
  seedSession(ACTIVE, {
    datetime: '2026-06-08T19:00:00-04:00',
    settled: { at: new Date().toISOString(), costPerPerson: 10, totalCost: 40, courtTotal: 40, birdTotal: 0, playerCount: 4, playerNames: [] },
  });
  seedPlayer(ACTIVE, 'Lin', { owedAmount: 10, paid: false });
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('the e-transfer address is one value (groups OFF, BPM has a group doc)', () => {
  it('the admin screen shows what members are told', async () => {
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12, eTransferRecipient: A } });
    adminMember().eTransferRecipient = B;

    expect((await screen())?.email).toBe(A.email);
    expect((await home())?.email).toBe(A.email);
  });

  it('a save reaches members', async () => {
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12, eTransferRecipient: A } });
    adminMember().eTransferRecipient = B;

    const res = await settingsPatch(makeAdminRequest('PATCH', 'http://x/api/admin/settings', { eTransferRecipient: C }));
    expect(res.status).toBe(200);

    expect((await screen())?.email).toBe(C.email);
    expect((await home())?.email).toBe(C.email);
    // The Member copy is still written: older code reads only that one.
    expect((adminMember().eTransferRecipient as { email: string }).email).toBe(C.email);
  });

  it('a past session’s receipt defaults to the same address', async () => {
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12, eTransferRecipient: A } });
    adminMember().eTransferRecipient = B;
    const PAST = 'session-2026-06-01';
    seedSession(PAST, {
      datetime: '2026-06-01T19:00:00-04:00',
      settled: { at: '2026-06-01T22:00:00-04:00', costPerPerson: 11, totalCost: 44, courtTotal: 44, birdTotal: 0, playerCount: 4, playerNames: ['Lin'] },
    });

    const res = await historyGet(makeAdminRequest('GET', 'http://x/api/sessions/history'));
    const row = (await res.json()).sessions.find((r: { sessionId: string }) => r.sessionId === PAST);
    expect(row.receipt.recipient.email).toBe(A.email);
  });

  it('no group doc (before a backfill): the admin’s own copy answers both, and a save writes no group doc', async () => {
    adminMember().eTransferRecipient = B;
    expect((await screen())?.email).toBe(B.email);
    expect((await home())?.email).toBe(B.email);

    await settingsPatch(makeAdminRequest('PATCH', 'http://x/api/admin/settings', { eTransferRecipient: C }));
    expect((await screen())?.email).toBe(C.email);
    expect((await home())?.email).toBe(C.email);
    expect(getStore()['groups'] ?? []).toHaveLength(0);
  });
});
