import { describe, it, expect, beforeEach } from 'vitest';
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
  seedMember,
  memberCookieValue,
} from './helpers';
import { DELETE, PATCH, POST } from '@/app/api/players/route';

/**
 * The late-cancellation handshake (docs/plans/late-cancel-fee.md).
 *
 * With the club's `lateCancelHours` set and the session inside that window, a
 * player's own cancel is REFUSED with 409 `late_cancel` until it carries
 * `acknowledgeLateFee: true`, and a cancel the server finds late is stamped
 * `lateCancel` whatever the request said. Admins, waitlist rows, a session
 * with no start time and a club with the policy off are never stopped.
 */
const TOKEN = 'a'.repeat(32);
const SESSION_ID = 'session-2026-10-16';
const H = 3_600_000;
const URL = 'http://localhost:3000/api/players';

const rowOf = (id: string) =>
  (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;
const cancel = (extra: Record<string, unknown> = {}) =>
  DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: TOKEN, ...extra }));

function setup(opts: { policy?: number; startsInHours?: number | null } = {}) {
  seedGroup('bpm', {
    settings: { skipDates: [], maxPlayers: 12, ...(opts.policy !== undefined ? { lateCancelHours: opts.policy } : {}) },
  });
  const startsIn = opts.startsInHours === undefined ? 20 : opts.startsInHours;
  seedSession(SESSION_ID, startsIn === null ? { datetime: undefined } : { datetime: new Date(Date.now() + startsIn * H).toISOString() });
}

describe('DELETE /api/players — late cancellation', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
    seedPointer(SESSION_ID);
  });

  it('refuses a late self-cancel without the acknowledgement, and changes nothing', async () => {
    setup({ policy: 48, startsInHours: 20 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'late_cancel', hours: 48 });
    expect(rowOf(p.id).removed).toBe(false);
  });

  it('cancels with the acknowledgement and stamps the row late, with the hours before the start', async () => {
    setup({ policy: 48, startsInHours: 20.5 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    const res = await cancel({ acknowledgeLateFee: true });
    expect(res.status).toBe(200);
    const row = rowOf(p.id);
    expect(row.removed).toBe(true);
    expect(row.cancelledBySelf).toBe(true);
    expect(row.lateCancel).toBe(true);
    expect(row.lateCancelHoursBefore).toBe(20);
  });

  it('cancels outside the window without asking, and stamps nothing', async () => {
    setup({ policy: 48, startsInHours: 72 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    expect((await cancel()).status).toBe(200);
    const row = rowOf(p.id);
    expect(row.removed).toBe(true);
    expect(row.lateCancel).toBeUndefined();
  });

  it('never stops a cancel when the club has the policy off', async () => {
    setup({ startsInHours: 2 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    expect((await cancel()).status).toBe(200);
    expect(rowOf(p.id).lateCancel).toBeUndefined();
  });

  it('never stops someone leaving the waitlist', async () => {
    setup({ policy: 48, startsInHours: 2 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN, waitlisted: true });
    expect((await cancel()).status).toBe(200);
    expect(rowOf(p.id).lateCancel).toBeUndefined();
  });

  it('never stops an admin removing a player', async () => {
    setup({ policy: 48, startsInHours: 2 });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    const res = await DELETE(makeAdminRequest('DELETE', URL, { name: 'Alice' }));
    expect(res.status).toBe(200);
    const row = rowOf(p.id);
    expect(row.removed).toBe(true);
    expect(row.lateCancel).toBeUndefined();
  });

  it('never stops a cancel for a session with no start time', async () => {
    setup({ policy: 48, startsInHours: null });
    const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    expect((await cancel()).status).toBe(200);
    expect(rowOf(p.id).lateCancel).toBeUndefined();
  });

  it('checks ownership before the policy: a wrong token is a 401, never a hint the cancel would be late', async () => {
    setup({ policy: 48, startsInHours: 2 });
    seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN });
    const res = await DELETE(makeRequest('DELETE', URL, { name: 'Alice', deleteToken: 'b'.repeat(32) }));
    expect(res.status).toBe(401);
  });

  /**
   * The stamp describes ONE cancellation. A row can come back active — the
   * same player signing up again that week, or an admin restoring them — and
   * a stamp left on it would tag a later, ordinary removal "Late", and ride
   * along in the roster every member reads.
   */
  describe('the stamp never outlives the cancel it describes', () => {
    it('a cancel outside the window does not inherit an old stamp', async () => {
      setup({ policy: 48, startsInHours: 72 });
      const p = seedPlayer(SESSION_ID, 'Alice', { deleteToken: TOKEN, lateCancel: true, lateCancelHoursBefore: 5 });
      expect((await cancel()).status).toBe(200);
      const row = rowOf(p.id);
      expect(row.removed).toBe(true);
      expect(row.lateCancel).toBeUndefined();
      expect(row.lateCancelHoursBefore).toBeUndefined();
    });

    it('signing up again clears it', async () => {
      setup({ policy: 48, startsInHours: 72 });
      // Members-only: Alice signs up again as herself, with her account cookie.
      const alice = seedMember('Alice');
      const p = seedPlayer(SESSION_ID, 'Alice', { removed: true, removedAt: new Date().toISOString(), cancelledBySelf: true, lateCancel: true, lateCancelHoursBefore: 5 });
      const res = await POST(makeRequest('POST', URL, {}, { Cookie: `member_session=${memberCookieValue('Alice', alice.id)}` }));
      expect(res.status).toBe(201);
      const row = rowOf(p.id);
      expect(row.removed).toBe(false);
      expect(row.lateCancel).toBeUndefined();
      expect(row.lateCancelHoursBefore).toBeUndefined();
    });

    it('an admin restore clears it', async () => {
      setup({ policy: 48, startsInHours: 72 });
      const p = seedPlayer(SESSION_ID, 'Alice', { removed: true, removedAt: new Date().toISOString(), cancelledBySelf: true, lateCancel: true, lateCancelHoursBefore: 5 });
      const res = await PATCH(makeAdminRequest('PATCH', URL, { id: p.id, removed: false }));
      expect(res.status).toBe(200);
      const row = rowOf(p.id);
      expect(row.removed).toBe(false);
      expect(row.lateCancel).toBeUndefined();
      expect(row.lateCancelHoursBefore).toBeUndefined();
    });
  });
});
