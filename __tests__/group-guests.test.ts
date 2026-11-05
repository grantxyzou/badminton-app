import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return { ...real, sendPushToMembers: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })) };
});

import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  seedSession,
  seedPlayer,
  seedDoc,
  makeRequest,
  adminCookieValue,
  memberCookieValue,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as SIGN_UP, DELETE as REMOVE } from '@/app/api/players/route';
import { GET as SESSION } from '@/app/api/session/route';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';
import { formatRosterText } from '@/lib/rosterText';
import { parseRosterText } from '@/lib/rosterImport';

/**
 * Guests the way Six Feathers brings them (docs/plans/six-feathers-guests.md).
 * Club X runs "Members first" (two guests each); BPM keeps the old switch on,
 * which reads as one. Josh is on both lists so only the club tells them apart.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const H = 3_600_000;
const URL = 'http://x/api/players';

type Row = Record<string, unknown> & { id: string };
const rows = () => (getStore()['players'] ?? []) as Row[];
const guestsOf = (memberId: string) => rows().filter((r) => r.guestOf === memberId && r.removed !== true);

let ip = 0;
const headers = (cookie: string) => ({ Cookie: cookie, 'X-Client-IP': `10.7.0.${++ip}` });
const asAdmin = (groupId: string) => `admin_session=${adminCookieValue({ groupId })}`;
// A fresh Josh per case: sign-up is rate-limited per MEMBER, and the limiter
// outlives the store reset.
let seq = 0;
let JOSH = 'm-josh-0';
const josh = (groupId: string) => `member_session=${memberCookieValue('Josh', JOSH, 3600, groupId)}`;

function club(groupId: string, settings: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const datetime = new Date(Date.now() + 48 * H).toISOString();
  const sessionId = sessionIdFromDate(datetime, groupId);
  seedGroup(groupId, { settings: { skipDates: [], maxPlayers: 12, ...settings } });
  seedSession(sessionId, { groupId, datetime, deadline: datetime, maxPlayers: 8, ...extra });
  seedDoc('sessions', { id: groupDocId(groupId, POINTER_ID), sessionId: groupDocId(groupId, POINTER_ID), groupId, activeSessionId: sessionId });
  seedMembership(groupId, JOSH, { name: 'Josh', regular: true });
  seedPlayer(sessionId, 'Josh', { groupId, memberId: JOSH, timestamp: '2026-11-01T10:00:00.000Z' });
  return sessionId;
}

const addGuest = async (cookie: string, name: string, extra: Record<string, unknown> = {}) => {
  const res = await SIGN_UP(makeRequest('POST', URL, { guest: { name }, ...extra }, headers(cookie)));
  return { status: res.status, body: (await res.json()) as Row };
};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  JOSH = `m-josh-${++seq}`;
  seedMember('Josh', { id: JOSH });
  process.env[FLAG] = 'true';
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('how many guests', () => {
  it('"Members first" lets a member bring two, written Jenny (Josh); a third is refused', async () => {
    club('club-x', { run: { style: 'members_first' } });
    const first = await addGuest(josh('club-x'), 'Jenny');
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ name: 'Jenny (Josh)', guestName: 'Jenny', guestOf: JOSH });
    expect((await addGuest(josh('club-x'), 'Alex')).status).toBe(201);
    const third = await addGuest(josh('club-x'), 'Sam');
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ error: 'guest_exists', limit: 2 });
    expect(guestsOf(JOSH)).toHaveLength(2);
  });

  it('BPM, with the old switch on, still allows one', async () => {
    club('bpm', { guestsAllowed: true });
    expect((await addGuest(josh('bpm'), 'Jenny')).status).toBe(201);
    expect((await addGuest(josh('bpm'), 'Alex')).status).toBe(409);
  });

  it('a club with guests off refuses, and the session read says how many', async () => {
    club('club-x', { run: { style: 'custom', playersPerCourt: null, money: 'split', guests: 0 }, guestsAllowed: true });
    expect((await addGuest(josh('club-x'), 'Jenny')).status).toBe(403);
    const read = await (await SESSION(makeRequest('GET', 'http://x/api/session', undefined, headers(josh('club-x'))))).json();
    expect(read).toMatchObject({ guestsAllowed: false, guestsPerMember: 0 });
  });

  it('the same guest name twice for one member is refused', async () => {
    club('club-x', { run: { style: 'members_first' } });
    expect((await addGuest(josh('club-x'), 'Jenny')).status).toBe(201);
    expect((await addGuest(josh('club-x'), 'jenny')).status).toBe(409);
  });
});

describe('a name on the roster', () => {
  it('is refused as a guest in that club, and allowed where it is not on the roster', async () => {
    club('club-x', { run: { style: 'members_first' } });
    seedMember('Kodai', { id: 'm-kodai' });
    seedMembership('club-x', 'm-kodai', { name: 'Kodai', regular: false });
    const res = await addGuest(josh('club-x'), 'Kodai');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('guest_on_roster');

    club('bpm', { guestsAllowed: true });
    expect((await addGuest(josh('bpm'), 'Kodai')).status).toBe(201);
  });
});

describe('the organiser adds a guest for a member', () => {
  beforeEach(() => {
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
  });

  it('names the host, and meets the same rules', async () => {
    club('club-x', { run: { style: 'members_first' } }, { signupOpen: false });
    const res = await addGuest(asAdmin('club-x'), 'Jenny', { hostMemberId: JOSH });
    // Sign-ups closed does not stop the organiser, as with an admin's sign-up.
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Jenny (Josh)', guestOf: JOSH });
    await addGuest(asAdmin('club-x'), 'Alex', { hostMemberId: JOSH });
    expect((await addGuest(asAdmin('club-x'), 'Sam', { hostMemberId: JOSH })).status).toBe(409);
  });

  it('refuses a host who is not on this week’s list', async () => {
    club('club-x', { run: { style: 'members_first' } });
    seedMember('Lin', { id: 'm-lin' });
    seedMembership('club-x', 'm-lin', { name: 'Lin', regular: true });
    const res = await addGuest(asAdmin('club-x'), 'Jenny', { hostMemberId: 'm-lin' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('host_not_signed_up');
  });

  it('puts the guest on the waitlist while members get first pick', async () => {
    club('club-x', { run: { style: 'members_first' } }, {
      datetime: new Date(Date.now() + 144 * H).toISOString(),
      membersFirst: { daysBefore: 1, time: '00:00' },
    });
    const res = await addGuest(asAdmin('club-x'), 'Jenny', { hostMemberId: JOSH });
    expect(res.body).toMatchObject({ waitlisted: true, waitingForMembers: true });
  });

  it('a member cannot name another host', async () => {
    club('club-x', { run: { style: 'members_first' } });
    seedMember('Lin', { id: 'm-lin' });
    seedMembership('club-x', 'm-lin', { name: 'Lin', regular: true });
    const lin = `member_session=${memberCookieValue('Lin', 'm-lin', 3600, 'club-x')}`;
    const res = await addGuest(lin, 'Jenny', { hostMemberId: JOSH });
    // Read as Lin's own guest, and Lin is not on the list.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('host_not_signed_up');
    expect(guestsOf(JOSH)).toHaveLength(0);
  });
});

describe('removing one of two guests', () => {
  it('takes the one named by id and leaves the other', async () => {
    club('club-x', { run: { style: 'members_first' } });
    const jenny = (await addGuest(josh('club-x'), 'Jenny')).body;
    const alex = (await addGuest(josh('club-x'), 'Alex')).body;
    const res = await REMOVE(makeRequest('DELETE', URL, { guest: true, guestId: alex.id }, headers(josh('club-x'))));
    expect(res.status).toBe(200);
    expect(guestsOf(JOSH).map((g) => g.id)).toEqual([jenny.id]);
  });
});

describe('the copied list', () => {
  it('writes a guest as Name (Host), old rows included, and the roster import skips it', () => {
    const text = formatRosterText({
      groupName: 'Six Feathers',
      maxPlayers: 4,
      players: [
        { id: 'a', name: 'Josh', memberId: JOSH, timestamp: '2026-11-01T10:00:00.000Z' },
        { id: 'b', name: "Jenny (Josh's guest)", guestOf: JOSH, guestName: 'Jenny', timestamp: '2026-11-01T10:01:00.000Z' },
        { id: 'c', name: 'Alex (Josh)', guestOf: JOSH, guestName: 'Alex', timestamp: '2026-11-01T10:02:00.000Z', waitlisted: true },
      ],
    });
    expect(text).toContain('2. Jenny (Josh)');
    expect(text).toContain('1. Alex (Josh)');
    expect(text).not.toContain('guest)');
    const parsed = parseRosterText(text);
    expect(parsed.guests.map((g) => `${g.name}/${g.host}`).sort()).toEqual(['Alex/Josh', 'Jenny/Josh']);
    expect(parsed.rows.map((r) => r.name)).toContain('Josh');
    expect(parsed.rows.map((r) => r.name).some((n) => n.includes('Jenny') || n.includes('Alex'))).toBe(false);
  });
});
