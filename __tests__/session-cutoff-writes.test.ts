import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  makeRequest,
  memberCookieValue,
  getTestAdminName,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { SKILLS } from '@/lib/assessment';
import { decidePage } from '@/lib/pageGate';
import { PATCH as PATCH_JOB } from '@/app/api/stringing/jobs/[id]/route';
import { POST as CANCEL_JOB } from '@/app/api/stringing/jobs/[id]/cancel/route';
import { POST as ACCEPT_JOB } from '@/app/api/stringing/jobs/[id]/accept/route';
import { DELETE as UNLINK } from '@/app/api/auth/identity/route';
import { GET as AUTH_ME } from '@/app/api/auth/me/route';
import { POST as MIGRATE_START } from '@/app/api/auth/migrate/start/route';
import { POST as DRILL_DONE } from '@/app/api/stats/drills/done/route';
import { POST as EVENTS } from '@/app/api/events/route';
import { POST as CREATE_GROUP } from '@/app/api/groups/route';
import { POST as SWITCH_GROUP } from '@/app/api/groups/switch/route';
import { POST as JOIN_GROUP } from '@/app/api/groups/join/route';
import { POST as LOG_GAME } from '@/app/api/games/route';
import { POST as ASSESS } from '@/app/api/assessments/route';
import { POST as PUSH_SUBSCRIBE } from '@/app/api/push/subscribe/route';
import { PUT as GEAR_PUT } from '@/app/api/equipment/gear/route';
import { PATCH as ME_PATCH, DELETE as ME_DELETE } from '@/app/api/members/me/route';
import { POST as NUDGE } from '@/app/api/auth/nudge/route';

/**
 * "Sign out everywhere" reaches every route that acts AS the member
 * (docs/plans/claim-your-name.md, Decisions). #771 enforced the cutoff where
 * the membership is re-read; these routes trusted the cookie's signature
 * alone, so a phone the organiser had signed out could keep writing as that
 * person for 30 days — and, worse, set a first PIN, switch clubs, link Google
 * or mint a migration link, each of which hands back a FRESH session.
 *
 * Each route runs twice with the same cookie (minted 60 s ago) and the same
 * request: once with the cutoff BEFORE the cookie (control — the auth gate
 * passes, whatever the route then says), once with it AFTER (refused). The
 * control is what makes the refusal mean "the cutoff", not "a bad fixture".
 */
const FLAGS = ['NEXT_PUBLIC_FLAG_MULTI_GROUP', 'NEXT_PUBLIC_FLAG_STRINGING', 'NEXT_PUBLIC_FLAG_NATIVE_MIGRATE'] as const;
const saved = Object.fromEntries(FLAGS.map((f) => [f, process.env[f]]));

let lin: { id: string };
const linCookie = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id, undefined, 'club-x')}` });
const req = (method: string, path: string, body?: Record<string, unknown>) =>
  makeRequest(method, `http://localhost/bpm/api/${path}`, body, linCookie());
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Row = { id: string; sessionsNotBefore?: string };
const linMembership = () =>
  ((getStore()['memberships'] ?? []) as Row[]).find((m) => m.id === `club-x:${lin.id}`)!;
const linMember = () => ((getStore()['members'] ?? []) as Row[]).find((m) => m.id === lin.id)!;

/** The organiser's stamp, `secondsFromNow` relative to now: -120 is before
 *  the cookie (minted at -60), 0 is after it. */
const signOutAt = (secondsFromNow: number, doc: Row = linMembership()) => {
  doc.sessionsNotBefore = new Date(Date.now() + secondsFromNow * 1000).toISOString();
};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  for (const f of FLAGS) process.env[f] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Six Feathers' });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  lin = seedMember('Lin');
  seedMembership('club-x', lin.id, { name: 'Lin' });
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

type Case = { name: string; call: () => Promise<Response>; refused?: number };

const CASES: Case[] = [
  { name: 'stringer PATCH on a job', call: () => PATCH_JOB(req('PATCH', 'stringing/jobs/job-1', { memberId: 'someone', status: 'strung' }), ctx('job-1')) },
  { name: 'cancel a stringing request', call: () => CANCEL_JOB(req('POST', 'stringing/jobs/job-1/cancel'), ctx('job-1')) },
  { name: 'answer a stringer’s change', call: () => ACCEPT_JOB(req('POST', 'stringing/jobs/job-1/accept', { decision: 'accept' }), ctx('job-1')) },
  { name: 'disconnect Google', call: () => UNLINK(req('DELETE', 'auth/identity', { provider: 'google' })) },
  { name: 'mint a migration link', call: () => MIGRATE_START(req('POST', 'auth/migrate/start')) },
  { name: 'mark a drill done', call: () => DRILL_DONE(req('POST', 'stats/drills/done', { drillId: 'footwork-1', done: true })) },
  { name: 'write a usage beacon', call: () => EVENTS(req('POST', 'events', { kind: 'app_open', platform: 'web' })) },
  { name: 'create a club', call: () => CREATE_GROUP(req('POST', 'groups', { name: 'Late Smashers', rosterName: 'Lin' })) },
  { name: 'switch clubs', call: () => SWITCH_GROUP(req('POST', 'groups/switch', { groupId: 'club-x' })) },
  { name: 'join with a code', call: () => JOIN_GROUP(req('POST', 'groups/join', { code: 'ABCD2345' })) },
  {
    name: 'log a game',
    call: () => LOG_GAME(req('POST', 'games', { teamA: ['Lin', 'Viktor'], teamB: ['Akane', 'Kento'], scoreA: 21, scoreB: 15 })),
  },
  { name: 'save a check-in', call: () => ASSESS(req('POST', 'assessments', { name: 'Lin', ratings: [{ skillKey: SKILLS[0].key, value: 3 }] })) },
  {
    name: 'register a push device',
    call: () =>
      PUSH_SUBSCRIBE(
        req('POST', 'push/subscribe', {
          endpoint: 'https://push.example.com/send/cutoff',
          keys: { p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5CW8OyNhLGkGZ8Nm9A', auth: 'tBHItJI5svbpez7KI4CCXg' },
        }),
      ),
  },
  { name: 'add to the bag', call: () => GEAR_PUT(req('PUT', 'equipment/gear', { name: 'Lin', item: { category: 'racket', label: 'Astrox 88D' } })) },
  { name: 'set the privacy choice', call: () => ME_PATCH(req('PATCH', 'members/me', { name: 'Lin', statsPrivacy: { clubComparison: true } })) },
  // The accepted risk in the plan: an impostor's claim is taken back by
  // signing the name out — which means nothing if the impostor's old cookie
  // can still set the first PIN, since that response hands back a session.
  { name: 'set a first PIN', call: () => ME_PATCH(req('PATCH', 'members/me', { name: 'Lin', newPin: '4826' })) },
  { name: 'delete the account', call: () => ME_DELETE(req('DELETE', 'members/me', { confirm: true })) },
  // Reached through callerMemberId, a wrapper the canary did not follow until
  // 2026-11-09 — it wrote on the Member from a signed-out cookie.
  { name: 'dismiss the sign-in nudge', call: () => NUDGE(req('POST', 'auth/nudge')) },
];

describe('a session minted before "Sign out everywhere" is refused by every write', () => {
  it.each(CASES)('$name: passes the gate while the cutoff is older', async ({ call, refused = 401 }) => {
    signOutAt(-120);
    expect((await call()).status).not.toBe(refused);
  });

  it.each(CASES)('$name: refused once the cutoff is newer', async ({ call, refused = 401 }) => {
    signOutAt(0);
    expect((await call()).status).toBe(refused);
  });

  it('the refused PIN write sets nothing and mints no session', async () => {
    signOutAt(0);
    const res = await ME_PATCH(req('PATCH', 'members/me', { name: 'Lin', newPin: '4826' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('member_session=');
    expect((linMember() as Row & { pinHash?: string }).pinHash).toBeUndefined();
  });

  it('the refused nudge dismissal writes nothing on the Member', async () => {
    signOutAt(0);
    expect((await NUDGE(req('POST', 'auth/nudge'))).status).toBe(401);
    expect((linMember() as Row & { authNudge?: unknown }).authNudge).toBeUndefined();
  });
});

describe('the signed-in answers honour it too', () => {
  it('GET /api/auth/me says signed out, so Create a club asks for an account again', async () => {
    signOutAt(-120);
    expect(await (await AUTH_ME(req('GET', 'auth/me'))).json()).toMatchObject({ signedIn: true, name: 'Lin' });
    signOutAt(0);
    expect(await (await AUTH_ME(req('GET', 'auth/me'))).json()).toEqual({ signedIn: false, name: null });
  });

  it('the page gate shows the signed-out screen, never the club picker that would switch back in', async () => {
    signOutAt(-120);
    expect((await decidePage(req('GET', '') as NextRequest)).kind).toBe('app');
    signOutAt(0);
    // Before the fix the gate refused, then fell through to "no club" on the
    // cookie's signature alone and listed club-x — one tap on it minted a
    // fresh cookie for the club that had just signed Lin out.
    expect((await decidePage(req('GET', '') as NextRequest)).kind).toBe('signed-out');
  });

  it('a removed person in no club still reaches the picker (no cutoff, no refusal)', async () => {
    (linMembership() as Row & { status?: string }).status = 'removed';
    expect((await decidePage(req('GET', '') as NextRequest)).kind).toBe('no-club');
  });
});

describe('groups off: the Member copy is the cutoff', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
  });
  const bpmReq = (method: string, path: string, body?: Record<string, unknown>) =>
    makeRequest(method, `http://localhost/bpm/api/${path}`, body, {
      Cookie: `member_session=${memberCookieValue('Lin', lin.id)}`,
    });

  it('refuses a beacon and an account deletion from a cookie older than Member.sessionsNotBefore', async () => {
    signOutAt(-120, linMember());
    expect((await EVENTS(bpmReq('POST', 'events', { kind: 'app_open', platform: 'web' }))).status).toBe(201);
    signOutAt(0, linMember());
    expect((await EVENTS(bpmReq('POST', 'events', { kind: 'app_open', platform: 'web' }))).status).toBe(401);
    expect((await ME_DELETE(bpmReq('DELETE', 'members/me', { confirm: true }))).status).toBe(401);
  });
});

describe('a cutoff in ANOTHER club than the cookie names (audit, 2026-11-05)', () => {
  // Lin is in club-x (the cookie's club) and in club-y. Club-y signs Lin out;
  // club-x does not. The live check reads only club-x's cutoff, so both doors
  // that hand back a club-y cookie have to read club-y's.
  beforeEach(() => {
    seedGroup('clubyy', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Late Smashers' });
    seedMembership('clubyy', lin.id, { name: 'Lin' });
  });
  const linY = () => ((getStore()['memberships'] ?? []) as Row[]).find((m) => m.id === `clubyy:${lin.id}`)!;

  it('switch refuses a club whose own cutoff is newer than the cookie', async () => {
    signOutAt(-120, linY());
    expect((await SWITCH_GROUP(req('POST', 'groups/switch', { groupId: 'clubyy' }))).status).toBe(200);
    signOutAt(0, linY());
    expect((await SWITCH_GROUP(req('POST', 'groups/switch', { groupId: 'clubyy' }))).status).toBe(401);
  });

  it('a "welcome back" join refuses it too, and leaves the invite for its owner', async () => {
    const { mintInvite } = await import('@/lib/invites');
    signOutAt(0, linY());
    const invite = await mintInvite('clubyy', ADMIN_MEMBER_ID);
    const res = await JOIN_GROUP(req('POST', 'groups/join', { token: invite!.token }));
    expect(res.status).toBe(401);
    const { resolveInvite } = await import('@/lib/invites');
    expect(await resolveInvite(invite!.token, 'invite')).not.toBeNull();
  });
});
