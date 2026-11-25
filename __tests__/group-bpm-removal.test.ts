/**
 * Leaving a club is not leaving the app (2026-11-25, docs/plans/e2e-test-club.md).
 *
 * Removing someone from BPM Core used to write `Member.active = false`, the
 * flag-off rollback copy — and every sign-in and every club's admin check
 * reads that as "this account is off". A person in BPM Core who also ran
 * another club could then neither sign in nor act as that club's organiser,
 * adding their name back made a second account, and a migration re-run would
 * have put them straight back on BPM's roster. These pin the fix.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore, seedMember, seedGroup, seedMembership, setupAdminPin, seedTestAdminMember, seedSession, seedPointer,
  adminCookieValue, memberCookieValue, makeRequest, getStore,
} from './helpers';
import { POST as signin } from '../app/api/auth/signin/route';
import { DELETE as removeMember, PATCH as updateMember } from '../app/api/members/route';
import { POST as createPlayer } from '../app/api/players/route';
import { DELETE as removeFromGroup } from '../app/api/groups/members/[memberId]/route';
import { GET as current } from '../app/api/groups/current/route';
import { reserveIdentity } from '../lib/authIdentity';
import { hashPassword } from '../lib/passwordHash';
import { hashPin } from '../lib/recoveryHash';
import { isAdminAuthedWithMember } from '../lib/auth';
import { readMembership } from '../lib/groups';
import { backfillStatus, runBackfill } from '../lib/groupBackfill';
import { adminAddToRoster } from '../lib/roster';

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const PASSWORD = 'a good long password';
let prev: string | undefined;

beforeEach(() => {
  prev = process.env[FLAG];
  process.env[FLAG] = 'true';
  resetMockStore();
  setupAdminPin();
});
afterEach(() => {
  if (prev === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prev;
});

const members = () => getStore()['members'] as Array<{ id: string; name?: string; active?: boolean; role?: string; pinHash?: string; mergedInto?: string }>;
const memberDoc = (id: string) => members().find((m) => m.id === id);

/** Lin: in BPM Core (an admin there if asked), and the organiser of a second club. */
async function linInTwoClubs(opts: { bpmAdmin?: boolean } = {}) {
  await seedTestAdminMember(); // BPM Core's admin
  seedGroup('bpm', { name: 'BPM Core' });
  seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-lin' });
  const lin = seedMember('Lin', {
    id: 'm-lin', email: 'lin@example.com', passwordHash: await hashPassword(PASSWORD),
    ...(opts.bpmAdmin ? { role: 'admin' } : {}),
  });
  await reserveIdentity('email', 'lin@example.com', lin.id);
  seedMembership('bpm', lin.id, { name: 'Lin', ...(opts.bpmAdmin ? { role: 'admin' } : {}) });
  seedMembership('x', lin.id, { name: 'Lin', role: 'owner' });
  return lin;
}

const signIn = () =>
  signin(makeRequest('POST', 'http://localhost/api/auth/signin', { email: 'lin@example.com', password: PASSWORD }, { 'X-Client-IP': `r-${Math.random()}` }));
const asBpmAdmin = (method: 'DELETE' | 'PATCH', body: Record<string, unknown>) =>
  makeRequest(method, 'http://localhost/api/members', body, { Cookie: `admin_session=${adminCookieValue({ groupId: 'bpm' })}`, 'X-Client-IP': `r-${Math.random()}` });

describe('removing someone from BPM Core, with clubs on', () => {
  it('takes them off BPM Core’s list and leaves their account on', async () => {
    const lin = await linInTwoClubs();
    expect((await removeMember(asBpmAdmin('DELETE', { id: lin.id }))).status).toBe(200);

    expect((await readMembership('bpm', lin.id))?.status).toBe('removed');
    expect(memberDoc(lin.id)?.active).toBe(true);
    expect((await signIn()).status).toBe(200);
  });

  it('leaves them able to use, and run, their other club', async () => {
    const lin = await linInTwoClubs();
    await removeMember(asBpmAdmin('DELETE', { id: lin.id }));

    const inX = `member_session=${memberCookieValue('Lin', lin.id, 3600, 'x')}`;
    const cur = await current(new NextRequest('http://localhost/api/groups/current', { headers: { cookie: inX, 'x-client-ip': `r-${Math.random()}` } }));
    expect(cur.status).toBe(200);
    const asOrganiser = new NextRequest('http://localhost/api/x', {
      headers: { cookie: `admin_session=${adminCookieValue({ groupId: 'x', memberId: lin.id })}; ${inX}` },
    });
    expect((await isAdminAuthedWithMember(asOrganiser)).authed).toBe(true);
  });

  it('the Roster sheet’s “Active” box does the same, and drops the rollback rank', async () => {
    const lin = await linInTwoClubs({ bpmAdmin: true });
    const res = await updateMember(asBpmAdmin('PATCH', { id: lin.id, name: 'Lin', role: 'admin', active: false }));
    expect(res.status).toBe(200);

    expect((await readMembership('bpm', lin.id))?.status).toBe('removed');
    expect(memberDoc(lin.id)?.active).toBe(true);
    // The sheet sent the old rank back; a flag-off rollback must not read it.
    expect(memberDoc(lin.id)?.role).toBe('member');
    expect((await signIn()).status).toBe(200);
    expect((await readMembership('x', lin.id))?.role).toBe('owner');
  });

  it('removing a BPM Core admin drops the rollback rank too', async () => {
    const lin = await linInTwoClubs({ bpmAdmin: true });
    expect((await removeMember(asBpmAdmin('DELETE', { id: lin.id }))).status).toBe(200);
    expect(memberDoc(lin.id)?.role).toBe('member');
    expect(memberDoc(lin.id)?.active).toBe(true);
  });

  it('Restore turns back on an account the old removal switched off, but never a merged one', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    const locked = seedMember('Lin', { id: 'm-locked', active: false });
    seedMembership('bpm', locked.id, { name: 'Lin', status: 'removed' });
    const merged = seedMember('Kento', { id: 'm-merged', active: false, mergedInto: 'm-locked' });
    seedMembership('bpm', merged.id, { name: 'Kento', status: 'removed' });

    expect((await updateMember(asBpmAdmin('PATCH', { id: locked.id, active: true }))).status).toBe(200);
    expect(memberDoc(locked.id)?.active).toBe(true);
    expect((await readMembership('bpm', locked.id))?.status).toBe('active');

    await updateMember(asBpmAdmin('PATCH', { id: merged.id, active: true }));
    expect(memberDoc(merged.id)?.active).toBe(false);
  });

  it('adding a removed person’s name with a PIN makes a new account and never touches theirs', async () => {
    // Security review, 2026-11-25: a rejoin-by-name here let any club admin
    // remove someone, "create" their name with a PIN of the admin's choosing,
    // and sign in as them in every club they belong to.
    const lin = await linInTwoClubs();
    const theirPin = await hashPin('1111');
    memberDoc(lin.id)!.pinHash = theirPin;
    await removeMember(asBpmAdmin('DELETE', { id: lin.id }));

    const res = await createPlayer(
      makeRequest('POST', 'http://localhost/api/players', { name: 'Lin', pin: '4821', sessionSignup: false }, {
        Cookie: `admin_session=${adminCookieValue({ groupId: 'bpm' })}`, 'X-Client-IP': `r-${Math.random()}`,
      }),
    );
    expect(res.status).toBeLessThan(500);
    expect(memberDoc(lin.id)?.pinHash).toBe(theirPin);
    expect((await readMembership('bpm', lin.id))?.status).toBe('removed');
  });
});

describe('with clubs off, removal is unchanged', () => {
  it('still switches the account off: flag-off, BPM’s list IS the account', async () => {
    process.env[FLAG] = 'false';
    await seedTestAdminMember();
    const lin = seedMember('Lin');
    const res = await removeMember(makeRequest('DELETE', 'http://localhost/api/members', { id: lin.id }, { Cookie: `admin_session=${adminCookieValue({ groupId: null })}`, 'X-Client-IP': `r-${Math.random()}` }));
    expect(res.status).toBe(200);
    expect(memberDoc(lin.id)?.active).toBe(false);
  });
});

describe('the multi-club migration, with clubs on', () => {
  it('stands down: adds nobody to BPM Core and puts no removed member back', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-only-x' });
    const onlyX = seedMember('Viktor', { id: 'm-only-x' });
    seedMembership('x', onlyX.id, { name: 'Viktor', role: 'owner' });
    const left = seedMember('Akane', { id: 'm-left' }); // account on, removed from BPM Core
    seedMembership('bpm', left.id, { name: 'Akane', status: 'removed' });

    const s = await runBackfill({ dryRun: false });
    expect(s.memberships.stoodDown).toBe(true);
    expect(s.memberships).toMatchObject({ created: 0, rejoined: 0, deactivated: 0 });
    expect(await readMembership('bpm', onlyX.id)).toBeUndefined();
    expect((await readMembership('bpm', left.id))?.status).toBe('removed');
  });

  it('turns back on an account locked out by the old removal, and only that', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-locked' });
    const locked = seedMember('Lin', { id: 'm-locked', active: false });
    seedMembership('bpm', locked.id, { name: 'Lin', status: 'removed' });
    seedMembership('x', locked.id, { name: 'Lin', role: 'owner' });
    const merged = seedMember('Kento', { id: 'm-merged', active: false, mergedInto: 'm-locked' });
    seedMembership('x', merged.id, { name: 'Kento' });
    const gone = seedMember('Sindhu', { id: 'm-gone', active: false }); // in no club at all

    const status = await backfillStatus();
    expect(status.members.lockedOut).toBe(1);

    const dry = await runBackfill({ dryRun: true });
    expect(dry.memberships.reactivated).toBe(1);
    expect(memberDoc(locked.id)?.active).toBe(false); // a dry run writes nothing

    const run = await runBackfill({ dryRun: false });
    expect(run.memberships.reactivated).toBe(1);
    expect(memberDoc(locked.id)?.active).toBe(true);
    expect(memberDoc(merged.id)?.active).toBe(false);
    expect(memberDoc(gone.id)?.active).toBe(false);
    expect((await backfillStatus()).members.lockedOut).toBe(0);
  });
});

describe('the second review (2026-11-25): no credential through a name, no half-done refusal', () => {
  /** Someone the old BPM Core removal switched off while their place on the list stayed. */
  async function lockedButListed() {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    const v = seedMember('Viktor', { id: 'm-v', active: false, pinHash: await hashPin('1111') });
    seedMembership('bpm', v.id, { name: 'Viktor' }); // active, name reserved
    return v;
  }
  /** A plain BPM admin: not an organiser. */
  function plainAdmin() {
    seedMember('Akane', { id: 'm-plain', role: 'admin' });
    seedMembership('bpm', 'm-plain', { name: 'Akane', role: 'admin' });
    return `admin_session=${adminCookieValue({ groupId: 'bpm', memberId: 'm-plain' })}`;
  }
  const post = (body: Record<string, unknown>, cookie = `admin_session=${adminCookieValue({ groupId: 'bpm' })}`) =>
    createPlayer(makeRequest('POST', 'http://localhost/api/players', body, { Cookie: cookie, 'X-Client-IP': `r-${Math.random()}` }));

  it('"create account" on a switched-off holder’s name is refused and writes no PIN', async () => {
    const v = await lockedButListed();
    const before = memberDoc(v.id)?.pinHash;
    const res = await post({ name: 'Viktor', pin: '4821', sessionSignup: false });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('account_exists');
    expect(memberDoc(v.id)?.pinHash).toBe(before);
    expect(memberDoc(v.id)?.active).toBe(false); // refused before anything was written
  });

  it('an admin signing that name up for a night writes no PIN onto it either', async () => {
    const v = await lockedButListed();
    memberDoc(v.id)!.pinHash = undefined; // no PIN: the "first PIN" case
    seedSession('session-2026-12-03', { signupOpen: true });
    seedPointer('session-2026-12-03');
    await post({ name: 'Viktor', pin: '4821' });
    expect(memberDoc(v.id)?.pinHash).toBeUndefined();
  });

  it('a plain admin restores a former admin as a MEMBER: the stale rank is set aside, not refused', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    const lin = seedMember('Lin', { id: 'm-lin', active: false, role: 'admin' });
    seedMembership('bpm', lin.id, { name: 'Lin', status: 'removed', role: 'admin' });
    const cookie = plainAdmin();
    const res = await updateMember(makeRequest('PATCH', 'http://localhost/api/members', { id: lin.id, active: true, role: 'admin' }, { Cookie: cookie, 'X-Client-IP': `r-${Math.random()}` }));
    expect(res.status).toBe(200);
    const back = await readMembership('bpm', lin.id);
    expect(back?.status).toBe('active');
    expect(back?.role).toBe('member');
    expect(memberDoc(lin.id)?.active).toBe(true);
    expect(memberDoc(lin.id)?.role).toBe('member');
  });

  it('a rank named for someone off the list writes no admin onto the rollback copy', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    const lin = seedMember('Lin', { id: 'm-lin' });
    seedMembership('bpm', lin.id, { name: 'Lin', status: 'removed' });
    const cookie = plainAdmin();
    await updateMember(makeRequest('PATCH', 'http://localhost/api/members', { id: lin.id, role: 'admin' }, { Cookie: cookie, 'X-Client-IP': `r-${Math.random()}` }));
    expect(memberDoc(lin.id)?.role).toBe('member');
  });

  it('Restore of an account the old removal switched off drops a leftover admin rank', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    const lin = seedMember('Lin', { id: 'm-lin', active: false, role: 'admin' });
    seedMembership('bpm', lin.id, { name: 'Lin', status: 'removed' });
    await updateMember(asBpmAdmin('PATCH', { id: lin.id, active: true }));
    expect(memberDoc(lin.id)?.active).toBe(true);
    expect(memberDoc(lin.id)?.role).toBe('member'); // back as a member, not BPM's admin
  });

  it('the club-members route’s removal drops the rollback rank too', async () => {
    const lin = await linInTwoClubs({ bpmAdmin: true });
    const req = new NextRequest(`http://localhost/api/groups/members/${lin.id}`, {
      method: 'DELETE',
      headers: { cookie: `admin_session=${adminCookieValue({ groupId: 'bpm' })}`, 'x-client-ip': `r-${Math.random()}` },
    });
    expect((await removeFromGroup(req, { params: Promise.resolve({ memberId: lin.id }) })).status).toBe(200);
    expect(memberDoc(lin.id)?.role).toBe('member');
    expect(memberDoc(lin.id)?.active).toBe(true);
  });

  it('the migration leaves alone an account switched off while still on BPM’s list', async () => {
    // A removal made during a flag-off rollback writes only Member.active:
    // turning it back on would undo a removal someone chose.
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-bob' });
    const bob = seedMember('Bob', { id: 'm-bob', active: false });
    seedMembership('bpm', bob.id, { name: 'Bob' });
    seedMembership('x', bob.id, { name: 'Bob', role: 'owner' });

    expect((await backfillStatus()).members.lockedOut).toBe(0);
    const run = await runBackfill({ dryRun: false });
    expect(run.memberships.reactivated).toBe(0);
    expect(memberDoc(bob.id)?.active).toBe(false);
  });

  it('the migration’s repair drops a leftover admin rank', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-locked' });
    const locked = seedMember('Lin', { id: 'm-locked', active: false, role: 'admin' });
    seedMembership('bpm', locked.id, { name: 'Lin', status: 'removed' });
    seedMembership('x', locked.id, { name: 'Lin', role: 'owner' });
    await runBackfill({ dryRun: false });
    expect(memberDoc(locked.id)?.active).toBe(true);
    expect(memberDoc(locked.id)?.role).toBe('member');
  });
});

describe('the third review (2026-11-25): a first PIN is on-behalf, and one rule for turning an account on', () => {
  it('an admin’s sign-up carrying a PIN cannot set an admin’s first PIN', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedMember('Akane', { id: 'm-plain', role: 'admin' });
    seedMembership('bpm', 'm-plain', { name: 'Akane', role: 'admin' });
    const carolina = seedMember('Carolina', { id: 'm-car', role: 'admin' }); // no PIN: signs in with Google
    seedMembership('bpm', carolina.id, { name: 'Carolina', role: 'admin' });
    seedSession('session-2026-12-03', { signupOpen: true });
    seedPointer('session-2026-12-03');

    const res = await createPlayer(makeRequest('POST', 'http://localhost/api/players', { name: 'Carolina', pin: '5839' }, {
      Cookie: `admin_session=${adminCookieValue({ groupId: 'bpm', memberId: 'm-plain' })}`, 'X-Client-IP': `r-${Math.random()}`,
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('organiser_only');
    expect(memberDoc(carolina.id)?.pinHash).toBeUndefined();
  });

  /** Alex: removed from BPM Core while groups were OFF (account off, still on BPM's list as admin), and in club X. */
  function removedDuringRollback() {
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-xorg' });
    seedMember('Kento', { id: 'm-xorg' });
    seedMembership('x', 'm-xorg', { name: 'Kento', role: 'owner' });
    const alex = seedMember('Alex', { id: 'm-alex', active: false, role: 'admin' });
    seedMembership('bpm', alex.id, { name: 'Alex', role: 'admin' });
    seedMembership('x', alex.id, { name: 'Alex' });
    return alex;
  }

  it('another club’s Restore cannot turn back on someone BPM removed during a rollback', async () => {
    await seedTestAdminMember();
    const alex = removedDuringRollback();
    const res = await updateMember(makeRequest('PATCH', 'http://localhost/api/members', { id: alex.id, active: true }, {
      Cookie: `admin_session=${adminCookieValue({ groupId: 'x', memberId: 'm-xorg' })}`, 'X-Client-IP': `r-${Math.random()}`,
    }));
    expect(res.status).toBe(200);
    expect(memberDoc(alex.id)?.active).toBe(false);
    expect(memberDoc(alex.id)?.role).toBe('admin'); // untouched: still BPM's call
  });

  it('nor can another club adding the name', async () => {
    await seedTestAdminMember();
    const alex = removedDuringRollback();
    await adminAddToRoster('x', 'Alex');
    expect(memberDoc(alex.id)?.active).toBe(false);
  });

  it('adding the name of someone the old removal locked out turns them on without the old admin rank', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    seedGroup('x', { name: 'Other Club', ownerMemberId: 'm-xorg' });
    const lin = seedMember('Lin', { id: 'm-lin', active: false, role: 'admin' });
    seedMembership('bpm', lin.id, { name: 'Lin', status: 'removed', role: 'admin' });
    seedMembership('x', lin.id, { name: 'Lin' });
    const { created } = await adminAddToRoster('x', 'Lin');
    expect(created).toBe(false);
    expect(memberDoc(lin.id)?.active).toBe(true);
    expect(memberDoc(lin.id)?.role).toBe('member');
  });

  it('the club-members route drops a rollback rank the membership no longer shows', async () => {
    await seedTestAdminMember();
    seedGroup('bpm', { name: 'BPM Core' });
    // Demoted on the membership earlier, which never touched Member.role.
    const lin = seedMember('Lin', { id: 'm-lin', role: 'admin' });
    seedMembership('bpm', lin.id, { name: 'Lin', role: 'member' });
    const req = new NextRequest(`http://localhost/api/groups/members/${lin.id}`, {
      method: 'DELETE',
      headers: { cookie: `admin_session=${adminCookieValue({ groupId: 'bpm' })}`, 'x-client-ip': `r-${Math.random()}` },
    });
    expect((await removeFromGroup(req, { params: Promise.resolve({ memberId: lin.id }) })).status).toBe(200);
    expect(memberDoc(lin.id)?.role).toBe('member');
  });
});
