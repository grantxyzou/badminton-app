import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedMembership,
  seedGroup,
  getStore,
  makeRequest,
  memberCookieValue,
  adminCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { decidePage } from '@/lib/pageGate';
import { BPM_GROUP_ID } from '@/lib/groupScope';

/**
 * WHAT THE PAGE RENDERS (lib/pageGate.ts).
 *
 * Members only gives two answers; multi-group adds a third — a signed-in,
 * active member in no club — and the gate that decides it must stay the one
 * every club-data route calls. Both flags, both ways.
 */
const GROUPS = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const MEMBERS = 'NEXT_PUBLIC_FLAG_MEMBERS_ONLY';
const saved: Record<string, string | undefined> = {};

const asMember = (memberId: string, name: string, groupId: string | null = BPM_GROUP_ID) =>
  makeRequest('GET', 'http://localhost/bpm', undefined, {
    Cookie: `member_session=${memberCookieValue(name, memberId, 3600, groupId)}`,
  });

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: true });
  for (const f of [GROUPS, MEMBERS]) saved[f] = process.env[f];
  process.env[MEMBERS] = 'true';
  delete process.env[GROUPS];
});
afterEach(() => {
  for (const f of [GROUPS, MEMBERS]) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe('members only OFF', () => {
  it('is a pass-through: everyone gets the app, with no name', async () => {
    delete process.env[MEMBERS];
    expect(await decidePage(makeRequest('GET', 'http://localhost/bpm'))).toEqual({ kind: 'app', memberName: null });
  });
});

describe('members only ON, groups OFF — exactly what shipped', () => {
  it('no cookie → signed out', async () => {
    expect(await decidePage(makeRequest('GET', 'http://localhost/bpm'))).toEqual({ kind: 'signed-out' });
  });

  it('an active member is in BPM by definition → the app, with the CURRENT name', async () => {
    const lin = seedMember('Lin');
    expect(await decidePage(asMember(lin.id, 'Old Name', null))).toEqual({ kind: 'app', memberName: 'Lin' });
  });

  it('an inactive member → signed out, never no-club (a no-club member cannot exist flag-off)', async () => {
    const gone = seedMember('Gone', { active: false });
    expect(await decidePage(asMember(gone.id, 'Gone', null))).toEqual({ kind: 'signed-out' });
  });
});

describe('members only ON, groups ON', () => {
  beforeEach(() => {
    process.env[GROUPS] = 'true';
  });

  it('no cookie, or an expired one → signed out', async () => {
    expect(await decidePage(makeRequest('GET', 'http://localhost/bpm'))).toEqual({ kind: 'signed-out' });
    const lin = seedMember('Lin');
    const lapsed = makeRequest('GET', 'http://localhost/bpm', undefined, {
      Cookie: `member_session=${memberCookieValue('Lin', lin.id, -10, BPM_GROUP_ID)}`,
    });
    expect(await decidePage(lapsed)).toEqual({ kind: 'signed-out' });
  });

  it('an active membership in the claimed club → the app, under the ROSTER name', async () => {
    const lin = seedMember('Lin');
    seedMembership('club-x', lin.id, { name: 'Lin Dan' });
    expect(await decidePage(asMember(lin.id, 'Lin', 'club-x'))).toEqual({ kind: 'app', memberName: 'Lin Dan' });
  });

  it('a brand-new organiser — active account, no membership anywhere → no-club with no groups', async () => {
    const org = seedMember('Organiser');
    expect(await decidePage(asMember(org.id, 'Organiser'))).toEqual({
      kind: 'no-club',
      memberName: 'Organiser',
      groups: [],
    });
  });

  it('an inactive Member doc → signed out, however many memberships it holds', async () => {
    const gone = seedMember('Gone', { active: false });
    seedGroup('club-x');
    seedMembership('club-x', gone.id, { name: 'Gone' });
    expect(await decidePage(asMember(gone.id, 'Gone', 'club-y'))).toEqual({ kind: 'signed-out' });
  });

  it('removed from the claimed club but active in others → no-club with those clubs, oldest first, closed ones dropped', async () => {
    const lin = seedMember('Lin');
    seedGroup('club-old', { name: 'Old Club', closedAt: '2026-05-01T00:00:00Z' });
    seedGroup('club-b', { name: 'Club B' });
    seedGroup('club-a', { name: 'Club A' });
    seedMembership(BPM_GROUP_ID, lin.id, { name: 'Lin', status: 'removed' });
    seedMembership('club-old', lin.id, { name: 'Lin', joinedAt: '2026-01-01T00:00:00Z' });
    seedMembership('club-b', lin.id, { name: 'Lin B', role: 'admin', joinedAt: '2026-03-01T00:00:00Z' });
    seedMembership('club-a', lin.id, { name: 'Lin A', joinedAt: '2026-02-01T00:00:00Z' });

    const out = await decidePage(asMember(lin.id, 'Lin'));
    expect(out.kind).toBe('no-club');
    if (out.kind !== 'no-club') return;
    expect(out.memberName).toBe('Lin');
    expect(out.groups.map((g) => g.id)).toEqual(['club-a', 'club-b']);
    expect(out.groups[0]).toMatchObject({ name: 'Club A', rosterName: 'Lin A', role: 'member', current: false });
    expect(out.groups[1]).toMatchObject({ name: 'Club B', rosterName: 'Lin B', role: 'admin' });
  });

  it('an admin-only device (no member cookie) is still the app', async () => {
    const req = makeRequest('GET', 'http://localhost/bpm', undefined, {
      Cookie: `admin_session=${adminCookieValue({ groupId: BPM_GROUP_ID })}`,
    });
    const out = await decidePage(req);
    expect(out.kind).toBe('app');
    // The admin's own membership row exists (seeded with one) and names them.
    const row = (getStore()['memberships'] as Array<{ memberId: string; groupId: string }>).find(
      (m) => m.memberId === ADMIN_MEMBER_ID && m.groupId === BPM_GROUP_ID,
    );
    expect(row).toBeDefined();
  });
});

describe('the one gate', () => {
  it('lib/pageGate.ts decides through requireMember, not a second definition of "signed in"', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'pageGate.ts'), 'utf8');
    expect(src).toContain('requireMember(');
    // And it reads no club data: the only container it touches is `members`.
    expect(src.match(/getContainer\('([a-zA-Z]+)'\)/g)).toEqual(["getContainer('members')"]);
  });
});
