import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  seedPointer,
  seedSession,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  ADMIN_MEMBER_ID,
} from './helpers';
import { resolveActiveMemberId, resolveActiveSubject } from '@/lib/memberResolve';
import { rosterMembers, rosterMemberIds } from '@/lib/roster';
import { addMembership, readMembership, readGroup, reserveRosterName, rosterNameHolder } from '@/lib/groups';
import { GET as membersGet, POST as membersPost, PATCH as membersPatch, DELETE as membersDelete } from '@/app/api/members/route';
import { GET as meGet, PATCH as mePatch } from '@/app/api/members/me/route';
import { POST as signupPost } from '@/app/api/auth/signup/route';
import { GET as bandsGet } from '@/app/api/stats/club/bands/route';
import { memberCookieValue } from './helpers';
import { POST as playersPost } from '@/app/api/players/route';
import { GET as settingsGet, PATCH as settingsPatch } from '@/app/api/admin/settings/route';

/**
 * PHASE 2, PR 3: a NAME means something only inside a group.
 *
 * With the flag on, "who is Lin?" is answered by the group's name-reservation
 * doc (a point read) and the ACTIVE membership behind it — never by scanning
 * `members`, where the same name can be a different person in a different
 * club. The roster is the group's memberships joined to their Member docs; the
 * invite list IS the roster; the club's settings live on the group doc. With
 * the flag off every one of these is the `members` scan it always was, and
 * the existing suites are the proof of that.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];
const on = () => { process.env[FLAG] = 'true'; };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  delete process.env[FLAG];
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('memberResolve (groupId, name)', () => {
  it('flag OFF: the members scan, group ignored', async () => {
    const lin = seedMember('Lin');
    expect(await resolveActiveMemberId('anything', 'lin')).toBe(lin.id);
    expect((await resolveActiveSubject('anything', 'Nobody')).isMember).toBe(false);
  });

  it('flag ON: the same name is a different person in a different group, and a stranger in a third', async () => {
    on();
    const linA = seedMember('Lin');
    const linB = seedMember('Lin');
    await addMembership({ groupId: 'club-a', memberId: linA.id, name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'club-b', memberId: linB.id, name: 'Lin', joinedVia: 'link' });
    expect(await resolveActiveMemberId('club-a', ' LIN ')).toBe(linA.id);
    expect(await resolveActiveMemberId('club-b', 'lin')).toBe(linB.id);
    expect(await resolveActiveMemberId('club-c', 'Lin')).toBeNull();
    expect(await resolveActiveSubject('club-c', 'Lin')).toMatchObject({ isMember: false, memberId: 'name:lin' });
  });

  it('flag ON: a soft-deleted PERSON does not resolve through a membership nobody updated', async () => {
    on();
    const lin = seedMember('Lin', { active: false });
    await addMembership({ groupId: 'club-a', memberId: lin.id, name: 'Lin', joinedVia: 'link' });
    expect(await resolveActiveMemberId('club-a', 'Lin')).toBeNull();
  });

  it('flag ON: a removed membership does not resolve, even while the reservation lingers', async () => {
    on();
    const lin = seedMember('Lin');
    await reserveRosterName('club-a', 'Lin', lin.id);
    seedMembership('club-a', lin.id, { name: 'Lin', status: 'removed' });
    expect(await resolveActiveMemberId('club-a', 'Lin')).toBeNull();
  });
});

describe('the roster (lib/roster.ts)', () => {
  it('flag OFF: every active Member, by name', async () => {
    seedMember('Zed'); seedMember('Amy'); seedMember('Gone', { active: false });
    const names = (await rosterMembers('bpm')).map((e) => e.member.name);
    expect(names).toEqual(['Amy', 'Test Admin', 'Zed']);
    expect((await rosterMembers('bpm', { includeInactive: true })).map((e) => e.member.name)).toContain('Gone');
  });

  it('flag ON: the group’s memberships, under the group’s names, with the group’s roles', async () => {
    on();
    const p = seedMember('Person', { role: 'admin' });
    const q = seedMember('Quiet');
    seedMember('Elsewhere');
    await addMembership({ groupId: 'club-a', memberId: p.id, name: 'Pat', joinedVia: 'link' });
    await addMembership({ groupId: 'club-a', memberId: q.id, name: 'Quinn', role: 'admin', joinedVia: 'link' });
    seedMembership('club-a', 'purged-person', { name: 'Ghost' });
    const roster = await rosterMembers('club-a');
    expect(roster.map((e) => e.member.name)).toEqual(['Pat', 'Quinn']);
    // Member.role is the person's default; the group's role wins on the roster.
    expect(roster.find((e) => e.member.name === 'Pat')?.member.role).toBe('member');
    expect(roster.find((e) => e.member.name === 'Quinn')?.member.role).toBe('admin');
    // `rosterMemberIds` reads the MEMBERSHIPS and stops there — one query, no
    // point read per person. So an orphaned membership (`purged-person`: the
    // account was deleted, the row outlived it) stays in the set, where
    // `rosterMembers` drops it for having no Member doc. That is deliberate:
    // the set exists to narrow aggregates over PERSON containers, and a purged
    // member's rows went with them, so a ghost id matches nothing. Joining
    // every id to its Member doc to remove it would cost N Cosmos round-trips
    // per request on three hot paths — and would fail the whole aggregate on
    // one transient error, which inside the level fold degrades to zero seeds
    // rather than to an error anybody sees.
    expect(await rosterMemberIds('club-a')).toEqual(new Set([p.id, q.id, 'purged-person']));
  });
});

describe('GET /api/members', () => {
  it('flag ON: lists this group’s roster only, names for everyone, docs (stripped) for admins', async () => {
    on();
    const lin = seedMember('Lin', { pinHash: 'secret-hash' });
    await addMembership({ groupId: 'bpm', memberId: lin.id, name: 'Lin', joinedVia: 'backfill' });
    await addMembership({ groupId: 'bpm', memberId: ADMIN_MEMBER_ID, name: 'Test Admin', role: 'owner', joinedVia: 'backfill' });
    seedMembership('other', 'stranger', { name: 'Stranger' });
    seedMember('Stranger');
    const anon = await membersGet(makeGetRequest('http://x/api/members'));
    expect(await anon.json()).toEqual([{ name: 'Lin', active: true }, { name: 'Test Admin', active: true }]);
    const admin = await membersGet(makeGetRequest('http://x/api/members', true));
    const text = await admin.text();
    expect(text).toContain('"id"');
    expect(text).not.toContain('secret-hash');
    expect(text).not.toContain('Stranger');
  });
});

/** With groups on, an admin route admits the caller only through an admin membership in the claimed group (PR 2). */
const seedAdminOwnsBpm = () => seedMembership('bpm', ADMIN_MEMBER_ID, { name: 'Test Admin', role: 'owner' });

describe('POST /api/members (the invite list)', () => {
  it('flag ON: adds a membership and reserves the name in this group', async () => {
    on();
    seedAdminOwnsBpm();
    const res = await membersPost(makeAdminRequest('POST', 'http://x/api/members', { name: 'Newcomer' }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect((await readMembership('bpm', id))?.name).toBe('Newcomer');
    expect(await resolveActiveMemberId('bpm', 'newcomer')).toBe(id);
  });

  it('flag ON: a name in use HERE is a 409; the same name in ANOTHER club is free, and its soft-deleted stranger is never resurrected', async () => {
    on();
    seedAdminOwnsBpm();
    const lin = seedMember('Lin');
    await addMembership({ groupId: 'bpm', memberId: lin.id, name: 'Lin', joinedVia: 'backfill' });
    expect((await membersPost(makeAdminRequest('POST', 'http://x/api/members', { name: 'LIN' }))).status).toBe(409);
    // Club-other's Lin Dan is soft-deleted; BPM adding "Lin Dan" must be a NEW person, not that one.
    const stranger = seedMember('Lin Dan', { active: false, pinHash: 'theirs' });
    await addMembership({ groupId: 'other', memberId: stranger.id, name: 'Lin Dan', joinedVia: 'link' });
    const res = await membersPost(makeAdminRequest('POST', 'http://x/api/members', { name: 'Lin Dan' }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(id).not.toBe(stranger.id);
    expect((getStore()['members'] as { id: string; active: boolean }[]).find((m) => m.id === stranger.id)?.active).toBe(false);
    expect((await readMembership('bpm', id))?.name).toBe('Lin Dan');
  });

  it('flag ON: a name whose holder was removed from THIS roster rejoins that person rather than minting a duplicate', async () => {
    on();
    seedAdminOwnsBpm();
    const kento = seedMember('Kento', { pinHash: 'his' });
    // Removed, but the reservation lingers (a leftover from before removal released names).
    await reserveRosterName('bpm', 'Kento', kento.id);
    seedMembership('bpm', kento.id, { name: 'Kento', status: 'removed' });
    const res = await membersPost(makeAdminRequest('POST', 'http://x/api/members', { name: 'kento' }));
    expect([200, 201]).toContain(res.status);
    expect((await res.json()).id).toBe(kento.id);
    expect((await readMembership('bpm', kento.id))?.status).toBe('active');
    expect((getStore()['members'] as { name: string }[]).filter((m) => m.name.toLowerCase() === 'kento')).toHaveLength(1);
  });

  it('flag ON: PATCH rename moves the roster name and its reservation; DELETE removes from THIS roster and frees the name', async () => {
    on();
    seedAdminOwnsBpm();
    const lin = seedMember('Lin');
    await addMembership({ groupId: 'bpm', memberId: lin.id, name: 'Lin', joinedVia: 'backfill' });
    const viktor = seedMember('Viktor');
    await addMembership({ groupId: 'bpm', memberId: viktor.id, name: 'Viktor', joinedVia: 'backfill' });
    expect((await membersPatch(makeAdminRequest('PATCH', 'http://x/api/members', { id: lin.id, name: 'Viktor' }))).status).toBe(409);
    expect((await membersPatch(makeAdminRequest('PATCH', 'http://x/api/members', { id: lin.id, name: 'Linda' }))).status).toBe(200);
    expect(await resolveActiveMemberId('bpm', 'Linda')).toBe(lin.id);
    expect(await resolveActiveMemberId('bpm', 'Lin')).toBeNull();
    expect((await rosterMembers('bpm')).map((e) => e.member.name)).toContain('Linda');
    expect((await membersDelete(makeAdminRequest('DELETE', 'http://x/api/members', { id: viktor.id }))).status).toBe(200);
    expect((await readMembership('bpm', viktor.id))?.status).toBe('removed');
    expect(await rosterNameHolder('bpm', 'Viktor')).toBeNull();
    expect((await rosterMembers('bpm')).map((e) => e.member.name)).not.toContain('Viktor');
  });
});

describe('GET /api/members/me?name= (the sign-up probe)', () => {
  it('flag ON: answers for this group’s Lin, not another group’s', async () => {
    on();
    const ours = seedMember('Lin', { pinHash: 'h' });
    const theirs = seedMember('Lin');
    await addMembership({ groupId: 'bpm', memberId: ours.id, name: 'Lin', role: 'admin', joinedVia: 'backfill' });
    await addMembership({ groupId: 'other', memberId: theirs.id, name: 'Lin', joinedVia: 'link' });
    const res = await meGet(makeGetRequest('http://x/api/members/me?name=Lin'));
    expect(await res.json()).toMatchObject({ hasPin: true, role: 'admin' });
    const nobody = await meGet(makeGetRequest('http://x/api/members/me?name=Unknown'));
    expect(await nobody.json()).toMatchObject({ hasPin: false, role: 'member' });
  });
});

describe('email sign-up joins the group (POST /api/auth/signup)', () => {
  const PROVIDERS = 'NEXT_PUBLIC_FLAG_AUTH_PROVIDERS';
  const providersBefore = process.env[PROVIDERS];
  beforeEach(() => { process.env[PROVIDERS] = 'true'; });
  afterEach(() => { if (providersBefore === undefined) delete process.env[PROVIDERS]; else process.env[PROVIDERS] = providersBefore; });

  it('flag ON: refuses a name whose reservation lingers, and joins a fresh account to this group', async () => {
    on();
    const gone = seedMember('Ghost', { active: false });
    await reserveRosterName('bpm', 'Ghost', gone.id);
    const taken = await signupPost(makeRequest('POST', 'http://x/api/auth/signup', { name: 'Ghost', email: 'ghost@example.com', password: 'correct-horse-battery' }));
    expect(taken.status).toBe(409);
    const res = await signupPost(makeRequest('POST', 'http://x/api/auth/signup', { name: 'Fresh', email: 'fresh@example.com', password: 'correct-horse-battery' }));
    expect(res.status).toBe(201);
    const id = await resolveActiveMemberId('bpm', 'Fresh');
    expect(id).not.toBeNull();
    expect((await readMembership('bpm', id!))?.joinedVia).toBe('link');
  });
});

describe('PATCH /api/members/me and the bands consent gate resolve the SAME person as the probe', () => {
  it('flag ON: two Lins, two clubs — the PIN write and the privacy read land on this group’s Lin', async () => {
    on();
    const ours = seedMember('Lin', { statsPrivacy: { clubComparison: false, promptedAt: '2026-01-01T00:00:00Z' } });
    const theirs = seedMember('Lin', { pinHash: 'set', statsPrivacy: { clubComparison: true, promptedAt: '2026-01-01T00:00:00Z' } });
    await addMembership({ groupId: 'bpm', memberId: ours.id, name: 'Lin', joinedVia: 'backfill' });
    await addMembership({ groupId: 'other', memberId: theirs.id, name: 'Lin', joinedVia: 'link' });
    const cookie = { Cookie: `member_session=${memberCookieValue('Lin', ours.id, 3600, 'bpm')}` };
    const set = await mePatch(makeRequest('PATCH', 'http://x/api/members/me', { name: 'Lin', newPin: '4821' }, cookie));
    expect(set.status).toBe(200);
    const docs = getStore()['members'] as { id: string; pinHash?: string }[];
    expect(docs.find((m) => m.id === ours.id)?.pinHash).toBeTruthy();
    expect(docs.find((m) => m.id === theirs.id)?.pinHash).toBe('set');
    const bands = await bandsGet(makeRequest('GET', 'http://x/api/stats/club/bands?name=Lin', undefined, cookie));
    expect(bands.status).toBe(200);
    const body = await bands.json();
    // Ours declined comparison; theirs consented. The gate must read OURS: nothing revealed.
    expect(body.skills).toEqual([]);
  });
});

describe('POST /api/players (the session sign-up invite gate)', () => {
  beforeEach(() => {
    seedPointer('session-2026-09-17');
    seedSession('session-2026-09-17', { signupOpen: true, maxPlayers: 12 });
  });

  it('flag ON: a person on another group’s roster is a stranger here', async () => {
    on();
    const lin = seedMember('Lin');
    await addMembership({ groupId: 'other', memberId: lin.id, name: 'Lin', joinedVia: 'link' });
    await addMembership({ groupId: 'bpm', memberId: ADMIN_MEMBER_ID, name: 'Test Admin', role: 'owner', joinedVia: 'backfill' });
    const res = await playersPost(makeRequest('POST', 'http://x/api/players', { name: 'Lin' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('invite_list_not_found');
  });

  it('flag ON: a member of THIS group signs up and the player row links to them', async () => {
    on();
    const lin = seedMember('Lin');
    await addMembership({ groupId: 'bpm', memberId: lin.id, name: 'Lin', joinedVia: 'backfill' });
    const res = await playersPost(makeRequest('POST', 'http://x/api/players', { name: 'lin' }));
    expect(res.status).toBe(201);
    expect((await res.json()).memberId).toBe(lin.id);
  });

  it('flag ON: an admin signing up a new name adds them to this roster; a lingering reservation rejoins its holder', async () => {
    on();
    await addMembership({ groupId: 'bpm', memberId: ADMIN_MEMBER_ID, name: 'Test Admin', role: 'owner', joinedVia: 'backfill' });
    const res = await playersPost(makeAdminRequest('POST', 'http://x/api/players', { name: 'Walk In' }));
    expect(res.status).toBe(201);
    const { memberId } = await res.json();
    expect((await readMembership('bpm', memberId))?.name).toBe('Walk In');
    // Removed earlier, reservation left behind: the walk-in IS that person, not a duplicate.
    const back = seedMember('Returner');
    await reserveRosterName('bpm', 'Returner', back.id);
    seedMembership('bpm', back.id, { name: 'Returner', status: 'left' });
    const again = await playersPost(makeAdminRequest('POST', 'http://x/api/players', { name: 'Returner' }));
    expect(again.status).toBe(201);
    expect((await again.json()).memberId).toBe(back.id);
    expect((getStore()['members'] as { name: string }[]).filter((m) => m.name === 'Returner')).toHaveLength(1);
  });
});

describe('/api/admin/settings', () => {
  it('flag ON with a group doc: reads and writes groups.settings, and still mirrors the Member doc', async () => {
    on();
    seedAdminOwnsBpm();
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: ['2026-12-25'], maxPlayers: 12 } });
    const got = await settingsGet(makeGetRequest('http://x/api/admin/settings', true));
    expect(await got.json()).toEqual({ eTransferRecipient: null, skipDates: ['2026-12-25'] });
    const patched = await settingsPatch(makeAdminRequest('PATCH', 'http://x/api/admin/settings', { skipDates: ['2027-01-01'], eTransferRecipient: { name: 'Club', email: 'club@example.com' } }));
    expect(patched.status).toBe(200);
    expect((await readGroup('bpm'))?.settings).toMatchObject({ skipDates: ['2027-01-01'], eTransferRecipient: { name: 'Club' }, maxPlayers: 12 });
    const me = (getStore()['members'] as { id: string; skipDates?: string[] }[]).find((m) => m.id === ADMIN_MEMBER_ID);
    expect(me?.skipDates).toEqual(['2027-01-01']);
    const again = await settingsGet(makeGetRequest('http://x/api/admin/settings', true));
    expect(await again.json()).toEqual({ eTransferRecipient: { name: 'Club', email: 'club@example.com' }, skipDates: ['2027-01-01'] });
  });

  it('flag ON with a group doc that has no recipient yet: the admin’s own recipient still answers', async () => {
    on();
    seedAdminOwnsBpm();
    seedGroup('bpm', { ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: [], maxPlayers: 12 } });
    const me = (getStore()['members'] as { id: string; eTransferRecipient?: unknown; skipDates?: string[] }[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
    me.eTransferRecipient = { name: 'Grant', email: 'g@example.com' };
    me.skipDates = ['2026-11-11'];
    const got = await settingsGet(makeGetRequest('http://x/api/admin/settings', true));
    expect(await got.json()).toEqual({ eTransferRecipient: { name: 'Grant', email: 'g@example.com' }, skipDates: ['2026-11-11'] });
  });

  it('flag ON without a group doc (before the backfill): falls back to the admin’s Member doc', async () => {
    on();
    seedAdminOwnsBpm();
    const me = (getStore()['members'] as { id: string; skipDates?: string[] }[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
    me.skipDates = ['2026-10-01'];
    const got = await settingsGet(makeGetRequest('http://x/api/admin/settings', true));
    expect(await got.json()).toEqual({ eTransferRecipient: null, skipDates: ['2026-10-01'] });
  });
});
