import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const pushed: string[][] = [];
vi.mock('@/lib/push', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push')>();
  return {
    ...real,
    sendPushToMembers: vi.fn(async (ids: string[]) => {
      pushed.push(ids);
      return { configured: true, sent: ids.length, failed: 0, removed: 0 };
    }),
  };
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
import { POST as SIGN_UP, GET as ROSTER, DELETE as REMOVE, PATCH as MOVE } from '@/app/api/players/route';
import { GET as SESSION } from '@/app/api/session/route';
import { POST as LET_IN } from '@/app/api/session/members-first/route';
import { POST as ADVANCE } from '@/app/api/session/advance/route';
import { POINTER_ID, sessionIdFromDate } from '@/lib/cosmos';
import { groupDocId } from '@/lib/groupScope';

/**
 * Members first (docs/plans/members-first-window.md). Club X runs a window:
 * only someone marked a member takes a free spot until it ends, then the
 * waitlist moves up in sign-up order. BPM has no window and must not notice.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const H = 3_600_000;
const URL = 'http://x/api/players';

type Row = Record<string, unknown> & { id: string };
const rows = () => (getStore()['players'] ?? []) as Row[];
const rowOf = (id: string) => rows().find((r) => r.id === id)!;
const sessionDoc = (id: string) => (getStore()['sessions'] as Row[]).find((s) => s.id === id)!;

let ip = 0;
let seq = 0;
const headers = (cookie: string) => ({ Cookie: cookie, 'X-Client-IP': `10.9.0.${++ip}` });
const asAdmin = (groupId: string) => `admin_session=${adminCookieValue({ groupId })}`;

/** A person on club X's roster: `regular` true = member, false = drop-in, absent = unmarked. */
function person(groupId: string, name: string, regular?: boolean) {
  const id = `m-${name.toLowerCase()}-${++seq}`;
  seedMember(name, { id });
  seedMembership(groupId, id, { name, ...(regular === undefined ? {} : { regular }) });
  return { id, name, cookie: `member_session=${memberCookieValue(name, id, 3600, groupId)}` };
}

const OPEN = { daysBefore: 1, time: '00:00' };

/**
 * A club with an active session. `startsIn` hours from now; with `OPEN` a
 * session six days out has a window that ends days from now, and one twelve
 * hours out has a window that ended at least twelve hours ago.
 */
function club(groupId: string, opts: { startsIn?: number; rule?: unknown; maxPlayers?: number; extra?: Record<string, unknown> } = {}) {
  const datetime = new Date(Date.now() + (opts.startsIn ?? 144) * H).toISOString();
  const sessionId = sessionIdFromDate(datetime, groupId);
  seedGroup(groupId, { settings: { skipDates: [], maxPlayers: 12, guestsAllowed: true } });
  seedSession(sessionId, {
    groupId,
    datetime,
    deadline: datetime,
    maxPlayers: opts.maxPlayers ?? 4,
    ...(opts.rule === undefined ? {} : { membersFirst: opts.rule }),
    ...opts.extra,
  });
  seedDoc('sessions', {
    id: groupDocId(groupId, POINTER_ID),
    sessionId: groupDocId(groupId, POINTER_ID),
    groupId,
    activeSessionId: sessionId,
  });
  return sessionId;
}

const signUp = async (who: { cookie: string; name: string }, extra: Record<string, unknown> = {}) => {
  const res = await SIGN_UP(makeRequest('POST', URL, { name: who.name, ...extra }, headers(who.cookie)));
  return { status: res.status, body: (await res.json()) as Row };
};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  pushed.length = 0;
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('signing up while the window is open', () => {
  it('a member takes a free spot; a drop-in and an unmarked name wait with spots free', async () => {
    club('club-x', { rule: OPEN });
    const member = await signUp(person('club-x', 'Lin', true));
    const dropIn = await signUp(person('club-x', 'Viktor', false));
    const unmarked = await signUp(person('club-x', 'Akane'));
    expect(member.status).toBe(201);
    expect(member.body).toMatchObject({ waitlisted: false });
    expect(member.body.waitingForMembers).toBeUndefined();
    expect(dropIn.body).toMatchObject({ waitlisted: true, waitingForMembers: true });
    expect(unmarked.body).toMatchObject({ waitlisted: true, waitingForMembers: true });
  });

  it('BPM, with no window, gives a drop-in the spot as it always has', async () => {
    club('bpm');
    const dropIn = await signUp(person('bpm', 'Viktor', false));
    expect(dropIn.body).toMatchObject({ waitlisted: false });
  });

  it('a member’s guest waits with the drop-ins', async () => {
    club('club-x', { rule: OPEN });
    const lin = person('club-x', 'Lin', true);
    await signUp(lin);
    const res = await SIGN_UP(makeRequest('POST', URL, { guest: { name: 'Alex' } }, headers(lin.cookie)));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ waitlisted: true, waitingForMembers: true });
  });
});

describe('a spot freed during the window', () => {
  it('goes to the next MEMBER waiting, not to an earlier drop-in', async () => {
    const sessionId = club('club-x', { rule: OPEN, maxPlayers: 2 });
    const a = seedPlayer(sessionId, 'Ann', { groupId: 'club-x', timestamp: '2026-11-01T10:00:00.000Z' });
    seedPlayer(sessionId, 'Ben', { groupId: 'club-x', timestamp: '2026-11-01T10:01:00.000Z' });
    const dropIn = seedPlayer(sessionId, 'Dee', {
      groupId: 'club-x', waitlisted: true, waitingForMembers: true, timestamp: '2026-11-01T10:02:00.000Z',
    });
    const member = seedPlayer(sessionId, 'Cai', { groupId: 'club-x', waitlisted: true, timestamp: '2026-11-01T10:03:00.000Z' });
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
    const res = await REMOVE(makeRequest('DELETE', URL, { name: 'Ann' }, headers(asAdmin('club-x'))));
    expect(res.status).toBe(200);
    expect(rowOf(a.id).removed).toBe(true);
    expect(rowOf(member.id).waitlisted).toBe(false);
    expect(rowOf(dropIn.id).waitlisted).toBe(true);
  });
});

describe('the organiser moves a drop-in by hand during the window', () => {
  /**
   * The money-off list (docs/plans/money-off-session-list.md) can move a row
   * into the session and back. A hand promotion keeps `waitingForMembers` on
   * the row, and that is what keeps a drop-in moved BACK behind the members:
   * the automatic promotion passes over a flagged row while the window runs.
   * Clearing it on a hand promotion (as the plan first proposed) would have
   * let the drop-in take the next freed spot ahead of a member.
   */
  it('a drop-in promoted and moved back still waits behind a member; moving back promotes nobody', async () => {
    const sessionId = club('club-x', { rule: OPEN, maxPlayers: 2 });
    const ann = seedPlayer(sessionId, 'Ann', { groupId: 'club-x', timestamp: '2026-11-01T10:00:00.000Z' });
    const dee = seedPlayer(sessionId, 'Dee', {
      groupId: 'club-x', waitlisted: true, waitingForMembers: true, timestamp: '2026-11-01T10:01:00.000Z',
    });
    const cai = seedPlayer(sessionId, 'Cai', { groupId: 'club-x', waitlisted: true, timestamp: '2026-11-01T10:02:00.000Z' });
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
    const admin = () => headers(asAdmin('club-x'));

    const up = await MOVE(makeRequest('PATCH', URL, { id: dee.id, waitlisted: false }, admin()));
    expect(up.status).toBe(200);
    expect(rowOf(dee.id)).toMatchObject({ waitlisted: false, waitingForMembers: true });

    const back = await MOVE(makeRequest('PATCH', URL, { id: dee.id, waitlisted: true }, admin()));
    expect(back.status).toBe(200);
    expect(rowOf(dee.id).waitlisted).toBe(true);
    // A move back is the admin's choice of who waits: nobody moves up.
    expect(rowOf(cai.id).waitlisted).toBe(true);

    const res = await REMOVE(makeRequest('DELETE', URL, { name: 'Ann' }, admin()));
    expect(res.status).toBe(200);
    expect(rowOf(ann.id).removed).toBe(true);
    expect(rowOf(cai.id).waitlisted).toBe(false);
    expect(rowOf(dee.id).waitlisted).toBe(true);
  });
});

describe('when the window ends', () => {
  function ended() {
    const sessionId = club('club-x', { rule: OPEN, startsIn: 12, maxPlayers: 3 });
    seedPlayer(sessionId, 'Lin', { groupId: 'club-x', timestamp: '2026-11-01T10:00:00.000Z' });
    const early = seedPlayer(sessionId, 'Dee', {
      groupId: 'club-x', memberId: 'm-dee', waitlisted: true, waitingForMembers: true, timestamp: '2026-11-01T10:01:00.000Z',
    });
    const next = seedPlayer(sessionId, 'Eli', {
      groupId: 'club-x', memberId: 'm-eli', waitlisted: true, waitingForMembers: true, timestamp: '2026-11-01T10:02:00.000Z',
    });
    const last = seedPlayer(sessionId, 'Fay', {
      groupId: 'club-x', memberId: 'm-fay', waitlisted: true, timestamp: '2026-11-01T10:03:00.000Z',
    });
    return { sessionId, early, next, last };
  }

  it('the first visit lets the waitlist in, in sign-up order, once, with a push', async () => {
    const { sessionId, early, next, last } = ended();
    const viewer = person('club-x', 'Kento', true);
    const res = await SESSION(makeRequest('GET', 'http://x/api/session', undefined, headers(viewer.cookie)));
    expect(res.status).toBe(200);
    expect((await res.json()).membersFirstReleasedAt).toBeTruthy();
    expect(rowOf(early.id)).toMatchObject({ waitlisted: false });
    expect(rowOf(early.id).waitingForMembers).toBeUndefined();
    expect(rowOf(next.id).waitlisted).toBe(false);
    expect(rowOf(last.id).waitlisted).toBe(true);
    expect(pushed.flat()).toEqual(['m-dee', 'm-eli']);

    const stamp = sessionDoc(sessionId).membersFirstReleasedAt;
    pushed.length = 0;
    await ROSTER(makeRequest('GET', URL, undefined, headers(viewer.cookie)));
    expect(sessionDoc(sessionId).membersFirstReleasedAt).toBe(stamp);
    expect(pushed).toEqual([]);
  });

  it('a sign-up after the end does not jump the people who waited', async () => {
    const { early, next } = ended();
    const late = await signUp(person('club-x', 'Gil', false), { waitlist: true });
    expect(rowOf(early.id).waitlisted).toBe(false);
    expect(rowOf(next.id).waitlisted).toBe(false);
    expect(late.body).toMatchObject({ waitlisted: true });
    expect(late.body.waitingForMembers).toBeUndefined();
  });

  it('nothing moves once the session has started', async () => {
    const sessionId = club('club-x', { rule: OPEN, startsIn: -1 });
    const waiting = seedPlayer(sessionId, 'Dee', { groupId: 'club-x', waitlisted: true, waitingForMembers: true });
    const viewer = person('club-x', 'Kento', true);
    await SESSION(makeRequest('GET', 'http://x/api/session', undefined, headers(viewer.cookie)));
    expect(rowOf(waiting.id).waitlisted).toBe(true);
    expect(sessionDoc(sessionId).membersFirstReleasedAt).toBeUndefined();
  });
});

describe('the organiser lets the waitlist in early', () => {
  it('moves it up now, and only for an admin of the club', async () => {
    const sessionId = club('club-x', { rule: OPEN });
    const waiting = seedPlayer(sessionId, 'Dee', { groupId: 'club-x', waitlisted: true, waitingForMembers: true });
    const member = person('club-x', 'Lin', true);
    expect((await LET_IN(makeRequest('POST', 'http://x/api/session/members-first', {}, headers(member.cookie)))).status).toBe(401);
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
    const res = await LET_IN(makeRequest('POST', 'http://x/api/session/members-first', {}, headers(asAdmin('club-x'))));
    expect(res.status).toBe(200);
    expect((await res.json()).released).toBe(true);
    expect(rowOf(waiting.id).waitlisted).toBe(false);
    // A drop-in signing up now takes a spot: the window is over.
    expect((await signUp(person('club-x', 'Viktor', false))).body).toMatchObject({ waitlisted: false });
  });

  it('answers no_window for a session without one', async () => {
    club('club-x');
    seedMembership('club-x', ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
    const res = await LET_IN(makeRequest('POST', 'http://x/api/session/members-first', {}, headers(asAdmin('club-x'))));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('no_window');
  });
});

describe('advance copies the club’s rule onto the new session', () => {
  async function advance(groupId: string, run: unknown) {
    club(groupId);
    const group = (getStore()['groups'] as Row[]).find((g) => g.id === groupId)!;
    group.settings = { ...(group.settings as object), ...(run ? { run } : {}) };
    seedMembership(groupId, ADMIN_MEMBER_ID, { name: 'Organiser', role: 'owner' });
    const datetime = '2026-12-05T19:00:00-08:00';
    const res = await ADVANCE(
      makeRequest('POST', 'http://x/api/session/advance', { datetime, maxPlayers: 32, courts: 4 }, headers(asAdmin(groupId))),
    );
    expect(res.status).toBe(201);
    return (await res.json()) as Row;
  }

  it('a "Members first" club gets its window', async () => {
    const created = await advance('club-x', { style: 'members_first', playersPerCourt: 8, money: 'off' });
    expect(created.membersFirst).toEqual({ daysBefore: 5, time: '23:59' });
  });

  it('a first come, first served club gets none', async () => {
    const created = await advance('club-x', { style: 'first_come', playersPerCourt: null, money: 'split' });
    expect(created.membersFirst).toBeUndefined();
  });
});
