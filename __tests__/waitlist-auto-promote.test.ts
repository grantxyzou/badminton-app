import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedGroup,
  makeRequest,
  makeAdminRequest,
  seedAdminMember,
  getStore,
} from './helpers';

/**
 * WHEN A SPOT OPENS, THE FIRST PERSON WAITING TAKES IT
 * (docs/plans/waitlist-auto-promote.md). A cancel, an admin removal or a raised
 * cap moves the earliest waitlister into the spot and pushes them; a held row,
 * a started or settled session, and a move back to the waitlist do not.
 */
type Payload = { title: string; body: string; url?: string; tag?: string };
const sendPushToMembers = vi.fn(async (_ids: string[], _p: Payload) => ({
  configured: true, sent: 1, failed: 0, removed: 0,
}));
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (ids: string[], p: Payload) => sendPushToMembers(ids, p),
  sendPushToAll: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

import { DELETE, PATCH } from '@/app/api/players/route';
import { PUT } from '@/app/api/session/route';
import { planPromotions, promotionOpen } from '@/lib/waitlistPromote';
import { buildWaitlistPromotedPayload } from '@/lib/pushMessages';

const SESSION_ID = 'session-2026-10-30';
const TOKEN = 'a'.repeat(32);
const H = 3_600_000;
const URL = 'http://localhost:3000/api/players';
const at = (minute: number) => `2026-10-27T10:${String(minute).padStart(2, '0')}:00.000Z`;
const rowOf = (id: string) =>
  (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;

/** A full 2-player session: Alice and Bob in, Cara then Dan waiting. */
function seedFull(session: Record<string, unknown> = {}) {
  seedSession(SESSION_ID, { maxPlayers: 2, datetime: new Date(Date.now() + 20 * H).toISOString(), ...session });
  const alice = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN, timestamp: at(1), memberId: 'm-alice' });
  const bob = seedPlayer(SESSION_ID, 'Bob', { timestamp: at(2), memberId: 'm-bob' });
  const dan = seedPlayer(SESSION_ID, 'Dan', { waitlisted: true, timestamp: at(4), memberId: 'm-dan' });
  const cara = seedPlayer(SESSION_ID, 'Cara', { waitlisted: true, timestamp: at(3), memberId: 'm-cara' });
  return { alice, bob, cara, dan };
}

describe('waitlist auto-promote', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
    sendPushToMembers.mockClear();
  });

  it('a self-cancel moves the EARLIEST waitlister in, stamps promotedAt, and pushes them', async () => {
    const { alice, cara, dan } = seedFull();
    expect((await DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: TOKEN }))).status).toBe(200);
    expect(rowOf(alice.id).removed).toBe(true);
    expect(rowOf(cara.id).waitlisted).toBe(false);
    expect(typeof rowOf(cara.id).promotedAt).toBe('string');
    expect(rowOf(dan.id).waitlisted).toBe(true);
    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    expect(sendPushToMembers.mock.calls[0][0]).toEqual(['m-cara']);
  });

  it('leaving the waitlist frees no spot and promotes nobody', async () => {
    const { cara, dan } = seedFull();
    rowOf(cara.id).deleteToken = TOKEN;
    expect((await DELETE(makeRequest('DELETE', URL, { name: 'Cara', deleteToken: TOKEN }))).status).toBe(200);
    expect(rowOf(dan.id).waitlisted).toBe(true);
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('an admin removing a player promotes too, by DELETE and by PATCH removed:true', async () => {
    const { bob, cara, dan } = seedFull();
    expect((await DELETE(makeAdminRequest('DELETE', URL, { name: 'Alice' }))).status).toBe(200);
    expect(rowOf(cara.id).waitlisted).toBe(false);
    expect((await PATCH(makeAdminRequest('PATCH', URL, { id: bob.id, removed: true }))).status).toBe(200);
    expect(rowOf(dan.id).waitlisted).toBe(false);
  });

  it('an admin moving someone BACK to the waitlist does not promote (it would undo the move)', async () => {
    const { alice, cara } = seedFull();
    expect((await PATCH(makeAdminRequest('PATCH', URL, { id: alice.id, waitlisted: true }))).status).toBe(200);
    expect(rowOf(alice.id).waitlisted).toBe(true);
    expect(rowOf(cara.id).waitlisted).toBe(true);
  });

  it('skips a held-for-unpaid waitlister and takes the next one', async () => {
    const { cara, dan } = seedFull();
    rowOf(cara.id).heldForUnpaid = true;
    await DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: TOKEN }));
    expect(rowOf(cara.id).waitlisted).toBe(true);
    expect(rowOf(dan.id).waitlisted).toBe(false);
  });

  it('does nothing once the session has started, or on a settled session', async () => {
    const { cara } = seedFull({ datetime: new Date(Date.now() - H).toISOString() });
    await DELETE(makeAdminRequest('DELETE', URL, { name: 'Alice' }));
    expect(rowOf(cara.id).waitlisted).toBe(true);

    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
    const settled = seedFull({ settled: { costPerPerson: 10 } });
    await DELETE(makeAdminRequest('DELETE', URL, { name: 'Alice' }));
    expect(rowOf(settled.cara.id).waitlisted).toBe(true);
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('raising the cap fills every new spot in sign-up order; lowering it promotes nobody', async () => {
    const { cara, dan } = seedFull();
    const url = 'http://localhost:3000/api/session';
    expect((await PUT(makeAdminRequest('PUT', url, { maxPlayers: 1 }))).status).toBe(200);
    expect(rowOf(cara.id).waitlisted).toBe(true);
    expect((await PUT(makeAdminRequest('PUT', url, { maxPlayers: 4 }))).status).toBe(200);
    expect(rowOf(cara.id).waitlisted).toBe(false);
    expect(rowOf(dan.id).waitlisted).toBe(false);
  });

  it('a row promoted inside the late-cancel window can give the spot back without the late tag', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, lateCancelHours: 48 } });
    const { cara } = seedFull();
    await DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: TOKEN, acknowledgeLateFee: true }));
    expect(rowOf(cara.id).waitlisted).toBe(false);
    rowOf(cara.id).deleteToken = TOKEN;
    const res = await DELETE(makeRequest('DELETE', URL, { name: 'Cara', deleteToken: TOKEN }));
    expect(res.status).toBe(200);
    expect(rowOf(cara.id).removed).toBe(true);
    expect(rowOf(cara.id).lateCancel).toBeUndefined();
  });

  it('rejoining after a promoted cancel is a choice: the next late cancel is tagged', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, lateCancelHours: 48 } });
    const { cara } = seedFull();
    await DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: TOKEN, acknowledgeLateFee: true }));
    expect(typeof rowOf(cara.id).promotedAt).toBe('string');
    // Cara gives the spot back, then rejoins: the same row comes back into play.
    Object.assign(rowOf(cara.id), { removed: true, removedAt: new Date().toISOString() });
    const { POST } = await import('@/app/api/players/route');
    const signup = await POST(makeAdminRequest('POST', URL, { name: 'Cara' }));
    expect(signup.status).toBe(201);
    const { deleteToken } = await signup.json();
    expect(rowOf(cara.id).promotedAt).toBeUndefined();
    const res = await DELETE(makeRequest('DELETE', URL, { name: 'Cara', deleteToken }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'late_cancel' });
  });

  it('an admin restore drops an old promotedAt', async () => {
    seedSession(SESSION_ID, { maxPlayers: 3 });
    const p = seedPlayer(SESSION_ID, 'Cara', { removed: true, promotedAt: new Date().toISOString() });
    const cara = { id: p.id };
    expect((await PATCH(makeAdminRequest('PATCH', URL, { id: cara.id, removed: false }))).status).toBe(200);
    expect(rowOf(cara.id).promotedAt).toBeUndefined();
  });

  it('a row promoted BEFORE the window still meets the late-cancel rule', async () => {
    seedGroup('bpm', { settings: { skipDates: [], maxPlayers: 12, lateCancelHours: 48 } });
    const { cara } = seedFull();
    Object.assign(rowOf(cara.id), { waitlisted: false, promotedAt: new Date(Date.now() - 72 * H).toISOString(), deleteToken: TOKEN });
    const res = await DELETE(makeRequest('DELETE', URL, { name: 'Cara', deleteToken: TOKEN }));
    expect(res.status).toBe(409);
  });

  it('a manual promotion stamps promotedAt; a move back clears it', async () => {
    seedSession(SESSION_ID, { maxPlayers: 3 });
    const p = seedPlayer(SESSION_ID, 'Eve', { waitlisted: true });
    await PATCH(makeAdminRequest('PATCH', URL, { id: p.id, waitlisted: false }));
    expect(typeof rowOf(p.id).promotedAt).toBe('string');
    await PATCH(makeAdminRequest('PATCH', URL, { id: p.id, waitlisted: true }));
    expect(rowOf(p.id).promotedAt).toBeUndefined();
  });
});

describe('planPromotions / promotionOpen / payload', () => {
  const row = (id: string, minute: number, extra: Record<string, unknown> = {}) =>
    ({ id, name: id, sessionId: 's', timestamp: at(minute), paid: false, ...extra }) as never;

  it('fills only the free spots, earliest first, ignoring removed and held rows', () => {
    const rows = [
      row('a', 1), row('b', 2, { removed: true }),
      row('w3', 5, { waitlisted: true }), row('w1', 3, { waitlisted: true, heldForUnpaid: true }), row('w2', 4, { waitlisted: true }),
    ];
    expect(planPromotions(rows, 2).map((r) => r.id)).toEqual(['w2']);
    expect(planPromotions(rows, 5).map((r) => r.id)).toEqual(['w2', 'w3']);
    expect(planPromotions(rows, 1)).toEqual([]);
  });

  it('is open only before the start of an unsettled session with a start time', () => {
    const now = Date.parse('2026-10-30T01:00:00Z');
    expect(promotionOpen({ datetime: '2026-10-30T02:00:00Z' }, now)).toBe(true);
    expect(promotionOpen({ datetime: '2026-10-30T00:00:00Z' }, now)).toBe(false);
    expect(promotionOpen({}, now)).toBe(false);
    expect(promotionOpen({ datetime: '2026-10-30T02:00:00Z', settled: {} as never }, now)).toBe(false);
    expect(promotionOpen(null, now)).toBe(false);
  });

  it('names the day in Vancouver time, not the server zone, and carries no money', () => {
    // 7 PM Thursday in Vancouver is 2 AM Friday in UTC.
    const p = buildWaitlistPromotedPayload({ id: 'session-2026-10-30', datetime: '2026-10-30T02:00:00Z' });
    expect(p.title).toBe("You're in");
    expect(p.body).toContain("Thursday's session");
    expect(p.body).not.toMatch(/\$/);
    expect(buildWaitlistPromotedPayload({}).body).toContain("off the waitlist");
  });
});
