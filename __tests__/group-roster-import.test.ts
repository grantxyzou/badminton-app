import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  makeRequest,
  adminCookieValue,
  getTestAdminName,
  getStore,
  ADMIN_MEMBER_ID,
} from './helpers';
import { POST as importRoster } from '@/app/api/members/import/route';
import { POST as addMember, PATCH as patchMember, GET as getMembers } from '@/app/api/members/route';

/**
 * The roster import (docs/plans/roster-import.md). The admin is the owner of
 * club-x; BPM is another club that shares a name with it ("Lin"), so only the
 * group can tell the two apart.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const before = process.env[FLAG];

type MembershipRow = { groupId: string; memberId: string; name: string; status: string; regular?: boolean; kind?: string };
const memberships = () => ((getStore()['memberships'] ?? []) as MembershipRow[]).filter((m) => !m.kind);
const rosterOf = (groupId: string) => memberships().filter((m) => m.groupId === groupId && m.status === 'active');

const asAdmin = (groupId = 'club-x') => ({ Cookie: `admin_session=${adminCookieValue({ groupId })}` });
const post = (body: Record<string, unknown>, groupId = 'club-x') =>
  importRoster(makeRequest('POST', 'http://x/api/members/import', body, asAdmin(groupId)));

let bpmLin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  process.env[FLAG] = 'true';
  seedGroup('bpm', { ownerMemberId: 'grant' });
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID });
  seedMembership('club-x', ADMIN_MEMBER_ID, { name: getTestAdminName(), role: 'owner' });
  bpmLin = seedMember('Lin');
  seedMembership('bpm', bpmLin.id, { name: 'Lin', role: 'member', regular: false });
});
afterEach(() => {
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('POST /api/members/import — the preview', () => {
  it('sorts each row and writes nothing', async () => {
    const viktor = seedMember('Viktor');
    seedMembership('club-x', viktor.id, { name: 'Viktor', regular: true });
    const carolina = seedMember('Carolina');
    seedMembership('club-x', carolina.id, { name: 'Carolina' });
    const chris = seedMember('Chris L.');
    seedMembership('club-x', chris.id, { name: 'Chris L.' });
    const rosterBefore = rosterOf('club-x').length;

    const res = await post({
      dryRun: true,
      rows: [
        { name: 'Lin', regular: true },
        { name: ' viktor ', regular: true },
        { name: 'Carolina', regular: false },
        { name: 'chris l', regular: true },
        { name: 'LIN', regular: true },
        { name: '   ', regular: true },
        { name: 'x'.repeat(51), regular: true },
      ],
    });
    expect(res.status).toBe(200);
    const { rows } = await res.json();
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual([
      // Lin is on BPM's roster, not this one.
      'new',
      'unchanged',
      'update',
      'similar',
      'duplicate',
      'invalid',
      'invalid',
    ]);
    expect(rows[2].current).toBeNull();
    expect(rows[3].similarTo).toBe('Chris L.');
    expect(rows[5].reason).toBe('empty');
    expect(rows[6].reason).toBe('too_long');
    expect(rosterOf('club-x')).toHaveLength(rosterBefore);
  });

  it('says a name reserved by someone no longer active comes back as them', async () => {
    const akane = seedMember('Akane', { active: false });
    seedMembership('club-x', akane.id, { name: 'Akane', status: 'removed', reserveName: true });
    const { rows } = await (await post({ dryRun: true, rows: [{ name: 'Akane', regular: true }] })).json();
    expect(rows[0].kind).toBe('returning');
  });
});

describe('POST /api/members/import — the import', () => {
  it('adds each new name to THIS roster, marked as asked', async () => {
    const res = await post({
      rows: [
        { name: 'Lin', regular: true },
        { name: 'Kento', regular: false },
      ],
    });
    const { results } = await res.json();
    expect(results).toEqual([
      { name: 'Lin', outcome: 'added' },
      { name: 'Kento', outcome: 'added' },
    ]);
    const roster = rosterOf('club-x');
    expect(roster.find((m) => m.name === 'Lin')?.regular).toBe(true);
    expect(roster.find((m) => m.name === 'Kento')?.regular).toBe(false);
    // A new person, not BPM's Lin joined to this club.
    expect(roster.find((m) => m.name === 'Lin')?.memberId).not.toBe(bpmLin.id);
  });

  it('never touches another club’s roster or marks', async () => {
    await post({ rows: [{ name: 'Lin', regular: true }] });
    const bpm = rosterOf('bpm');
    expect(bpm).toHaveLength(1);
    expect(bpm[0].regular).toBe(false);
  });

  it('marks someone already here, and is a no-op the second time', async () => {
    const viktor = seedMember('Viktor');
    seedMembership('club-x', viktor.id, { name: 'Viktor', regular: true });
    const rows = [
      { name: 'Viktor', regular: false },
      { name: 'Sindhu', regular: true },
    ];
    const first = await (await post({ rows })).json();
    expect(first.results.map((r: { outcome: string }) => r.outcome)).toEqual(['updated', 'added']);
    const again = await (await post({ rows })).json();
    expect(again.results.map((r: { outcome: string }) => r.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(rosterOf('club-x').filter((m) => m.name === 'Sindhu')).toHaveLength(1);
  });

  it('skips a similar row unless the admin ticked it', async () => {
    const chris = seedMember('Chris L.');
    seedMembership('club-x', chris.id, { name: 'Chris L.' });
    const skipped = await (await post({ rows: [{ name: 'chris l', regular: true }] })).json();
    expect(skipped.results[0].outcome).toBe('skipped');
    const forced = await (await post({ rows: [{ name: 'chris l', regular: true, force: true }] })).json();
    expect(forced.results[0].outcome).toBe('added');
  });

  it('skips duplicates and invalid rows', async () => {
    const { results } = await (
      await post({ rows: [{ name: 'Taufik', regular: true }, { name: 'taufik', regular: true }, { name: '', regular: true }] })
    ).json();
    expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(['added', 'skipped', 'skipped']);
  });

  it('agrees with the add sheet: a name the sheet refuses is one the import calls unchanged', async () => {
    await post({ rows: [{ name: 'Kento', regular: true }] });
    const sheet = await addMember(makeRequest('POST', 'http://x/api/members', { name: 'Kento' }, asAdmin()));
    expect(sheet.status).toBe(409);
    expect((await sheet.json()).code).toBe('roster_name_taken');
  });
});

describe('POST /api/members/import — the gate', () => {
  it('refuses a non-admin', async () => {
    const res = await importRoster(makeRequest('POST', 'http://x/api/members/import', { rows: [{ name: 'Lin', regular: true }] }));
    expect(res.status).toBe(401);
  });

  it('refuses malformed rows and more than the cap', async () => {
    expect((await post({ rows: [] })).status).toBe(400);
    expect((await post({ rows: [{ name: 'Lin' }] })).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ name: `Player ${i}`, regular: true }));
    const res = await post({ rows: tooMany });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('too_many_rows');
  });
});

describe('POST /api/members/import — groups off', () => {
  beforeEach(() => {
    process.env[FLAG] = 'false';
  });

  it('adds new people and reactivates an inactive one, storing no marks', async () => {
    const lost = seedMember('Kento', { active: false });
    const { results } = await (
      await post({ rows: [{ name: 'Kento', regular: true }, { name: 'Sindhu', regular: false }] }, 'bpm')
    ).json();
    expect(results.map((r: { outcome: string }) => r.outcome)).toEqual(['rejoined', 'added']);
    const members = getStore()['members'] as { id: string; name: string; active: boolean }[];
    expect(members.find((m) => m.id === lost.id)?.active).toBe(true);
    expect(members.filter((m) => m.name === 'Sindhu')).toHaveLength(1);
  });

  it('calls an active name unchanged', async () => {
    const { rows } = await (await post({ dryRun: true, rows: [{ name: 'lin', regular: false }] }, 'bpm')).json();
    expect(rows[0].kind).toBe('unchanged');
  });
});

describe('member or drop-in on the Roster sheet', () => {
  it('PATCH { regular } marks THIS club’s membership, and GET shows it to the admin', async () => {
    const viktor = seedMember('Viktor');
    seedMembership('club-x', viktor.id, { name: 'Viktor' });
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: viktor.id, regular: false }, asAdmin()));
    expect(res.status).toBe(200);
    expect(rosterOf('club-x').find((m) => m.memberId === viktor.id)?.regular).toBe(false);
    const list = await (await getMembers(makeRequest('GET', 'http://x/api/members', undefined, asAdmin()))).json();
    expect(list.find((m: { id: string }) => m.id === viktor.id)?.regular).toBe(false);
  });

  it('is a 404 for someone on another club’s roster', async () => {
    const res = await patchMember(makeRequest('PATCH', 'http://x/api/members', { id: bpmLin.id, regular: true }, asAdmin()));
    expect(res.status).toBe(404);
    expect(rosterOf('bpm')[0].regular).toBe(false);
  });
});
