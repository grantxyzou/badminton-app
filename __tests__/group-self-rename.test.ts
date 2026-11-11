import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, setupAdminPin, seedMember, seedMembership, seedGroup, seedDoc, seedPlayer, seedAlias, makeRequest, memberCookieValue, getStore } from './helpers';
import { PATCH } from '@/app/api/members/me/name/route';
import { verifyMemberAuth } from '@/lib/auth';

/**
 * "What should the club call you?" (docs/plans/profile-nickname.md): a member
 * renames THEMSELVES in the club their cookie names. One name per club, unique
 * there, and the rows that hold it as text follow it.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
const SESSION = 'club-x:session-2026-11-12';

type Row = Record<string, unknown>;
const rows = (c: string) => (getStore()[c] ?? []) as Row[];
const membership = (groupId: string, memberId: string) =>
  rows('memberships').find((m) => m.groupId === groupId && m.memberId === memberId && m.kind === undefined);
const reservation = (groupId: string, lower: string) => rows('memberships').find((m) => m.id === `${groupId}:name:${lower}`);

let chris: { id: string };

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant', name: 'BPM Core' });
  seedGroup('club-x', { ownerMemberId: 'owner-x', name: 'Six Feathers' });
  chris = seedMember('Christopher Lu');
  seedMembership('club-x', chris.id, { name: 'Christopher Lu' });
  seedDoc('sessions', { id: 'club-x:active-session-pointer', sessionId: 'club-x:active-session-pointer', activeSessionId: SESSION, groupId: 'club-x' });
  seedDoc('sessions', { id: SESSION, sessionId: SESSION, groupId: 'club-x', datetime: '2026-11-12T20:00:00-08:00', maxPlayers: 12 });
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

let ipSeq = 0;
const rename = (body: Record<string, unknown>, memberId: string | null = chris.id, groupId = 'club-x', name = 'Christopher Lu') =>
  PATCH(
    makeRequest('PATCH', 'http://x/api/members/me/name', body, {
      'X-Client-IP': `10.77.0.${ipSeq++ % 250}`,
      ...(memberId ? { Cookie: `member_session=${memberCookieValue(name, memberId, undefined, groupId)}` } : {}),
    }),
  );

describe('PATCH /api/members/me/name', () => {
  it('renames the caller in their club, moves the reservation and re-mints the cookie', async () => {
    const res = await rename({ name: '  Chris   Lu ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, name: 'Chris Lu' });
    expect(membership('club-x', chris.id)?.name).toBe('Chris Lu');
    expect(reservation('club-x', 'chris lu')?.memberId).toBe(chris.id);
    expect(reservation('club-x', 'christopher lu')).toBeUndefined();
    // Another club's name never touches the person's own default name.
    expect(rows('members').find((m) => m.id === chris.id)?.name).toBe('Christopher Lu');
    const cookie = /member_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? '';
    const session = verifyMemberAuth(makeRequest('GET', 'http://x/', undefined, { Cookie: `member_session=${cookie}` }));
    expect(session).toMatchObject({ memberId: chris.id, name: 'Chris Lu', groupId: 'club-x' });
  });

  it('carries this week’s own sign-up and the e-transfer alias, never a guest row or someone else’s', async () => {
    const mine = seedPlayer(SESSION, 'Christopher Lu', { memberId: chris.id, groupId: 'club-x' });
    const guest = seedPlayer(SESSION, 'Jenny (Christopher Lu)', { guestOf: chris.id, groupId: 'club-x' });
    const other = seedMember('Lin Dan');
    const theirs = seedPlayer(SESSION, 'Lin Dan', { memberId: other.id, groupId: 'club-x' });
    const alias = seedAlias('Christopher Lu', 'CHRISTOPHER LU', 'club-x');
    const unrelated = seedAlias('Lin Dan', 'DAN LIN', 'club-x');

    expect((await rename({ name: 'Chris Lu' })).status).toBe(200);
    const player = (id: string) => rows('players').find((p) => p.id === id);
    expect(player(mine.id)?.name).toBe('Chris Lu');
    expect(player(guest.id)?.name).toBe('Jenny (Christopher Lu)');
    expect(player(theirs.id)?.name).toBe('Lin Dan');
    const aliasRow = (id: string) => rows('clubSettings').find((a) => a.id === id);
    expect(aliasRow(alias.id)).toMatchObject({ appName: 'Chris Lu', memberId: chris.id });
    expect(aliasRow(unrelated.id)?.appName).toBe('Lin Dan');
  });

  it('refuses a name someone else holds in the club, and changes nothing', async () => {
    const other = seedMember('Chris L');
    seedMembership('club-x', other.id, { name: 'Chris L' });
    const res = await rename({ name: 'chris l' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('name_taken');
    expect(membership('club-x', chris.id)?.name).toBe('Christopher Lu');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('allows a name another CLUB uses', async () => {
    const lin = seedMember('Chris');
    seedMembership('bpm', lin.id, { name: 'Chris' });
    expect((await rename({ name: 'Chris' })).status).toBe(200);
    expect(membership('club-x', chris.id)?.name).toBe('Chris');
  });

  it('writes the person’s own name too when the club is BPM (the rollback copy)', async () => {
    seedMembership('bpm', chris.id, { name: 'Christopher Lu' });
    expect((await rename({ name: 'Chris Lu' }, chris.id, 'bpm')).status).toBe(200);
    expect(membership('bpm', chris.id)?.name).toBe('Chris Lu');
    expect(rows('members').find((m) => m.id === chris.id)?.name).toBe('Chris Lu');
  });

  it('needs the member’s own cookie, and takes no one else’s id or name from the body', async () => {
    const other = seedMember('Lin Dan');
    seedMembership('club-x', other.id, { name: 'Lin Dan' });
    const anon = await rename({ name: 'Hacked', memberId: other.id }, null);
    expect(anon.status).toBe(401);
    const asChris = await rename({ name: 'Renamed', memberId: other.id });
    expect(asChris.status).toBe(200);
    expect(membership('club-x', other.id)?.name).toBe('Lin Dan');
    expect(membership('club-x', chris.id)?.name).toBe('Renamed');
  });

  it('refuses an empty or too-long name', async () => {
    expect((await rename({ name: '   ' })).status).toBe(400);
    expect((await rename({ name: 'x'.repeat(41) })).status).toBe(400);
    expect(membership('club-x', chris.id)?.name).toBe('Christopher Lu');
  });

  it('refuses someone no longer on the club’s roster', async () => {
    const gone = seedMember('Kento Momota');
    seedMembership('club-x', gone.id, { name: 'Kento Momota', status: 'removed' });
    expect((await rename({ name: 'Kento' }, gone.id, 'club-x', 'Kento Momota')).status).toBe(401);
  });
});
