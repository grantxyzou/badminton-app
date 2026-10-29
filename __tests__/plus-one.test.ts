import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedGroup,
  makeRequest,
  makeAdminRequest,
  seedAdminMember,
  memberCookieValue,
  getStore,
} from './helpers';

/**
 * A PLUS-ONE (docs/plans/plus-one.md): a signed-in member brings one guest.
 * The guest is a row of their own (`guestOf: host`, no `memberId`), takes a
 * spot or waits, is the HOST's line on the host's balance and in the ledger,
 * and leaves with the host.
 */
vi.mock('@/lib/push', () => ({
  sendPushToMembers: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })),
  sendPushToAll: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

import { POST, DELETE, PATCH } from '@/app/api/players/route';
import { computeOwed } from '@/lib/owedBalance';
import { groupScope } from '@/lib/groupScope';
import { chargeEntry } from '@/lib/ledgerMirror';
import { matchesIdentity } from '@/lib/playerIdentity';
import { anonymizePlayerRows, TOMBSTONE_NAME } from '@/lib/memberPurge';

const SESSION_ID = 'session-2026-10-30';
const URL = 'http://localhost:3000/api/players';
const H = 3_600_000;

type Row = Record<string, unknown> & { id: string };
const players = () => (getStore()['players'] ?? []) as Row[];
const rowOf = (id: string) => players().find((p) => p.id === id)!;
const guestRows = () => players().filter((p) => typeof p.guestOf === 'string');

function asMember(name: string, memberId: string, method: string, body: Record<string, unknown>) {
  return makeRequest(method, URL, body, { Cookie: `member_session=${memberCookieValue(name, memberId)}` });
}

// A fresh host per case: sign-up is rate-limited per MEMBER, and the limiter
// outlives the store reset.
let seq = 0;
let HOST = 'm-lin-0';

/** Lin is in; plus-ones on unless a case says otherwise. */
function seed({ guests = true, session = {} as Record<string, unknown> } = {}) {
  HOST = `m-lin-${++seq}`;
  seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, ...(guests ? { guestsAllowed: true } : {}) } });
  seedSession(SESSION_ID, { maxPlayers: 4, datetime: new Date(Date.now() + 48 * H).toISOString(), ...session });
  const lin = seedMember('Lin', { id: HOST });
  const lin2 = seedPlayer(SESSION_ID, 'Lin', { memberId: HOST, timestamp: '2026-10-27T10:01:00.000Z' });
  return { lin, linRow: lin2 };
}

const addGuest = (name = 'Alex') => POST(asMember('Lin', HOST, 'POST', { guest: { name } }));

describe('plus-one: adding a guest', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
  });

  it('is refused while the club has not switched it on', async () => {
    seed({ guests: false });
    const res = await addGuest();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('guests_off');
    expect(guestRows()).toHaveLength(0);
  });

  it('adds a row of its own: guestOf the host, no memberId, a display name', async () => {
    seed();
    const res = await addGuest('Alex');
    expect(res.status).toBe(201);
    const [g] = guestRows();
    expect(g.guestOf).toBe(HOST);
    expect(g.memberId).toBeUndefined();
    expect(g.guestName).toBe('Alex');
    expect(g.name).toBe("Alex (Lin's guest)");
    expect(g.waitlisted).toBe(false);
    expect(g.deleteToken).toBeUndefined();
  });

  it('needs the host on the list first, and allows only one guest', async () => {
    HOST = `m-lin-${++seq}`;
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, guestsAllowed: true } });
    seedSession(SESSION_ID, { maxPlayers: 4, datetime: new Date(Date.now() + 48 * H).toISOString() });
    seedMember('Lin', { id: HOST });
    expect((await (await addGuest()).json()).error).toBe('host_not_signed_up');

    seedPlayer(SESSION_ID, 'Lin', { memberId: HOST });
    expect((await addGuest()).status).toBe(201);
    const again = await addGuest('Sam');
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe('guest_exists');
  });

  it('refuses a bad name, a held host and a settled session', async () => {
    const { linRow } = seed();
    expect((await addGuest('')).status).toBe(400);
    expect((await addGuest('Al (fake)')).status).toBe(400);
    expect((await addGuest('x'.repeat(21))).status).toBe(400);

    rowOf(linRow.id).heldForUnpaid = true;
    rowOf(linRow.id).waitlisted = true;
    expect((await (await addGuest()).json()).error).toBe('host_held');

    rowOf(linRow.id).heldForUnpaid = undefined;
    rowOf(linRow.id).waitlisted = false;
    (getStore()['sessions'] as Row[]).find((s) => s.id === SESSION_ID)!.settled = true;
    expect((await (await addGuest()).json()).error).toBe('session_settled');
  });

  it('waits when the session is full, or when the host is waiting', async () => {
    const { linRow } = seed({ session: { maxPlayers: 1 } });
    await addGuest();
    expect(guestRows()[0].waitlisted).toBe(true);

    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
    const again = seed({ session: { maxPlayers: 4 } });
    rowOf(again.linRow.id).waitlisted = true;
    await addGuest();
    expect(guestRows()[0].waitlisted).toBe(true);
    expect(linRow).toBeTruthy();
  });

  it("a guest named like a member never blocks that member's own sign-up", async () => {
    seed();
    seedMember('Alex', { id: 'm-alex' });
    await addGuest('Alex');
    const res = await POST(asMember('Alex', 'm-alex', 'POST', {}));
    expect(res.status).toBe(201);
  });
});

describe('plus-one: cancelling', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
  });

  it('the host cancels just the guest; the host keeps their spot', async () => {
    const { linRow } = seed();
    await addGuest();
    const res = await DELETE(asMember('Lin', HOST, 'DELETE', { guest: true }));
    expect(res.status).toBe(200);
    expect(guestRows()[0].removed).toBe(true);
    expect(guestRows()[0].cancelledBySelf).toBe(true);
    expect(rowOf(linRow.id).removed).not.toBe(true);
  });

  it('nobody else reaches the guest — not by their own cookie, not by its name', async () => {
    seed();
    seedMember('Sam', { id: 'm-sam' });
    seedPlayer(SESSION_ID, 'Sam', { memberId: 'm-sam' });
    await addGuest();
    expect((await DELETE(asMember('Sam', 'm-sam', 'DELETE', { guest: true }))).status).toBe(404);
    expect((await DELETE(asMember('Sam', 'm-sam', 'DELETE', { name: "Alex (Lin's guest)" }))).status).toBe(404);
    expect(guestRows()[0].removed).not.toBe(true);
  });

  it('the guest leaves with the host, and both freed spots go to the waitlist', async () => {
    const { linRow } = seed({ session: { maxPlayers: 2 } });
    await addGuest();
    const cara = seedPlayer(SESSION_ID, 'Cara', { memberId: 'm-cara', waitlisted: true, timestamp: '2026-10-27T10:05:00.000Z' });
    const dan = seedPlayer(SESSION_ID, 'Dan', { memberId: 'm-dan', waitlisted: true, timestamp: '2026-10-27T10:06:00.000Z' });
    const res = await DELETE(asMember('Lin', HOST, 'DELETE', { name: 'Lin' }));
    expect(res.status).toBe(200);
    expect(rowOf(linRow.id).removed).toBe(true);
    expect(guestRows()[0].removed).toBe(true);
    expect(rowOf(cara.id).waitlisted).toBe(false);
    expect(rowOf(dan.id).waitlisted).toBe(false);
  });

  it('inside the late window the host is warned once, and both rows are tagged Late', async () => {
    const { linRow } = seed({ session: { datetime: new Date(Date.now() + 2 * H).toISOString() } });
    (getStore()['groups'] as Row[]).find((g) => g.id === 'bpm')!.settings = {
      skipDates: [], maxPlayers: 12, guestsAllowed: true, lateCancelHours: 24,
    };
    await addGuest();
    const warned = await DELETE(asMember('Lin', HOST, 'DELETE', { name: 'Lin' }));
    expect(warned.status).toBe(409);
    expect((await warned.json()).error).toBe('late_cancel');
    expect(guestRows()[0].removed).not.toBe(true);

    const res = await DELETE(asMember('Lin', HOST, 'DELETE', { name: 'Lin', acknowledgeLateFee: true }));
    expect(res.status).toBe(200);
    expect(rowOf(linRow.id).lateCancel).toBe(true);
    expect(guestRows()[0].lateCancel).toBe(true);
  });

  it('an admin removing the host removes the guest too', async () => {
    const { linRow } = seed();
    await addGuest();
    const res = await PATCH(makeAdminRequest('PATCH', URL, { id: linRow.id, removed: true }));
    expect(res.status).toBe(200);
    expect(guestRows()[0].removed).toBe(true);
    expect(guestRows()[0].cancelledBySelf).toBe(false);
  });
});

describe('plus-one: money', () => {
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-11-06');
  });

  function seedSettled() {
    seedSession(SESSION_ID, { settled: true, datetime: '2026-10-30T02:00:00.000Z' });
    seedMember('Lin', { id: 'm-lin' });
    seedMember('Alex', { id: 'm-alex' });
    seedPlayer(SESSION_ID, 'Lin', { memberId: 'm-lin', owedAmount: 12, settledAt: '2026-10-31T00:00:00.000Z' });
    return seedPlayer(SESSION_ID, "Alex (Lin's guest)", {
      guestOf: 'm-lin', guestName: 'Alex', owedAmount: 12, settledAt: '2026-10-31T00:00:00.000Z',
    });
  }

  it("the guest's share is a line on the host's balance, named for the guest", async () => {
    const guest = seedSettled();
    const owed = await computeOwed(groupScope('bpm'), { memberId: 'm-lin', names: new Set(['lin']) });
    expect(owed.sessions.map((s) => s.playerId).sort()).toContain(guest.id);
    expect(owed.sessions).toHaveLength(2);
    expect(owed.sessions.find((s) => s.playerId === guest.id)?.guestName).toBe('Alex');
  });

  it('and never on the balance of a member who shares the guest’s name', async () => {
    seedSettled();
    const owed = await computeOwed(groupScope('bpm'), { memberId: 'm-alex', names: new Set(['alex', "alex (lin's guest)"]) });
    expect(owed.sessions).toHaveLength(0);
    expect(matchesIdentity({ name: 'Alex', guestOf: 'm-lin' }, { memberId: null, names: new Set(['alex']) })).toBe(false);
  });

  it('the ledger charges the guest row to the host', () => {
    const e = chargeEntry(
      { id: 'g1', sessionId: SESSION_ID, guestOf: 'm-lin', owedAmount: 12, settledAt: '2026-10-31T00:00:00.000Z' },
      { datetime: '2026-10-30T02:00:00.000Z' },
    );
    expect(e?.memberId).toBe('m-lin');
  });

  it("deleting the host's account anonymizes the guest rows they brought", async () => {
    seedSettled();
    seedPlayer('session-2026-11-06', "Sam (Lin's guest)", { guestOf: 'm-lin', guestName: 'Sam' });
    await anonymizePlayerRows('m-lin', 'Lin', 'session-2026-11-06');
    expect(players().some((p) => typeof p.guestOf === 'string' || typeof p.guestName === 'string')).toBe(false);
    expect(players().every((p) => p.name === TOMBSTONE_NAME)).toBe(true);
    const active = players().find((p) => p.sessionId === 'session-2026-11-06')!;
    expect(active.removed).toBe(true);
  });
});

describe('plus-one: the club switch', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
  });

  it('the admin turns it on, and the session read tells Home', async () => {
    const { PATCH: settingsPATCH } = await import('@/app/api/admin/settings/route');
    const { GET: sessionGET } = await import('@/app/api/session/route');
    seed({ guests: false });
    const before = await sessionGET(makeAdminRequest('GET', 'http://localhost:3000/api/session'));
    expect((await before.json()).guestsAllowed).toBe(false);

    const res = await settingsPATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', { guestsAllowed: true }));
    expect(res.status).toBe(200);
    const after = await sessionGET(makeAdminRequest('GET', 'http://localhost:3000/api/session'));
    expect((await after.json()).guestsAllowed).toBe(true);
    expect((await addGuest()).status).toBe(201);

    expect((await settingsPATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', { guestsAllowed: 'yes' }))).status).toBe(400);
  });
});
