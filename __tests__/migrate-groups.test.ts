import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedDoc,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedSession,
  seedPlayer,
  seedAnnouncement,
  makeRequest,
  adminCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET, POST } from '@/app/api/admin/migrate-groups/route';
import { backfillStatus, runBackfill, stampRow, chooseOwner, STAMPED_CONTAINERS } from '@/lib/groupBackfill';
import { readGroup, readMembership, listMemberships, reserveRosterName } from '@/lib/groups';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { containersOfScope } from '@/lib/containers';

/**
 * THE BACKFILL, the run Grant does against production at the end of Phase 2.
 *
 * Idempotence is the whole contract: "run until the status is all zeros" is
 * the operating procedure, so a second run must create nothing and stamp
 * nothing. Collisions are reported, never thrown. A row edited between the
 * read and the write is skipped under IfMatch, never overwritten.
 */
const KEY = 'test-migration-key-0123456789abcdef';
const url = 'http://x/api/admin/migrate-groups';
const before = { key: process.env.MIGRATION_KEY, names: process.env.ADMIN_NAMES };

const asAdmin = (headers: Record<string, string> = {}) => ({ Cookie: `admin_session=${adminCookieValue()}`, ...headers });
// The POST is rate-limited 5/15min per IP and the limiter is module state that
// outlives a `beforeEach`, so a shared default IP makes the SIXTH post in the
// file 429 wherever it happens to sit. Each call gets its own address unless a
// test is deliberately exercising the limiter.
let ipSeq = 0;
const post = (body: Record<string, unknown>, headers: Record<string, string> = {}, ip = `10.0.1.${++ipSeq}`) =>
  POST(makeRequest('POST', url, body, { ...asAdmin(headers), 'X-Client-IP': ip }));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  // No membership: the backfill's premise is Members with no memberships yet.
  await seedTestAdminMember({ membership: false });
  process.env.MIGRATION_KEY = KEY;
  delete process.env.ADMIN_NAMES;
});
afterEach(() => {
  if (before.key === undefined) delete process.env.MIGRATION_KEY; else process.env.MIGRATION_KEY = before.key;
  if (before.names === undefined) delete process.env.ADMIN_NAMES; else process.env.ADMIN_NAMES = before.names;
});

/** A realistic slice of BPM: sessions, players, a purchase, a settings doc — none stamped. */
function seedLegacyBpm() {
  seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
  seedPlayer('session-2026-09-03', 'Lin');
  seedPlayer('session-2026-09-03', 'Viktor');
  seedDoc('birds', { id: 'b1', name: 'Yonex', tubes: 4, totalCost: 80, costPerTube: 20, date: '2026-09-01' });
  seedDoc('clubSettings', { id: 'stringing', open: false });
  seedDoc('kudos', { id: 'k1', recipientMemberId: 'm-lin', raterMemberId: 'm-viktor', sessionId: 'session-2026-09-03' });
}

describe('locks', () => {
  it('GET is admin-only; POST needs the admin cookie AND the key; an unset key is a 503', async () => {
    expect((await GET(makeRequest('GET', url))).status).toBe(401);
    expect((await POST(makeRequest('POST', url, { dryRun: true }, { 'x-migration-key': KEY }))).status).toBe(401);
    expect((await post({ dryRun: true })).status).toBe(401);
    expect((await post({ dryRun: true }, { 'x-migration-key': 'wrong-key-wrong-key-wrong' })).status).toBe(401);
    delete process.env.MIGRATION_KEY;
    expect((await post({ dryRun: true }, { 'x-migration-key': KEY })).status).toBe(503);
  });

  it('rate-limits key guesses before checking anything', async () => {
    for (let i = 0; i < 5; i++) await post({ dryRun: true }, { 'x-migration-key': 'nope-nope-nope-nope-nope' }, '10.9.9.9');
    expect((await post({ dryRun: true }, { 'x-migration-key': KEY }, '10.9.9.9')).status).toBe(429);
  });
});

describe('status', () => {
  it('counts ONLY unstamped rows, per container — the mock cannot filter that in SQL, so the count is JS', async () => {
    seedLegacyBpm();
    seedDoc('birds', { id: 'b-stamped', name: 'Stamped', tubes: 1, totalCost: 20, costPerTube: 20, date: '2026-09-02', groupId: 'bpm' });
    seedDoc('birds', { id: 'b-other', name: 'Other', tubes: 1, totalCost: 20, costPerTube: 20, date: '2026-09-02', groupId: 'other' });
    const res = await GET(makeRequest('GET', url, undefined, asAdmin()));
    expect(res.status).toBe(200);
    const status = await res.json();
    expect(status.group).toBe('absent');
    expect(status.unstamped.birds).toBe(1);
    expect(status.unstamped.players).toBe(2);
    expect(status.unstamped.sessions).toBe(1);
    expect(status.unstamped.clubSettings).toBe(1);
    expect(status.unstamped.kudos).toBe(1);
    expect(status.members).toMatchObject({ total: 1, active: 1, withMembership: 0, withoutMembership: 1 });
    // Every group container except memberships is reported, even when zero.
    for (const c of containersOfScope('group')) {
      if (c === 'memberships') expect(status.unstamped).not.toHaveProperty(c);
      else expect(status.unstamped).toHaveProperty(c);
    }
  });
});

describe('the run', () => {
  it('dry run counts everything and writes nothing', async () => {
    seedLegacyBpm();
    seedMember('Lin'); seedMember('Viktor');
    const res = await post({ dryRun: true }, { 'x-migration-key': KEY });
    expect(res.status).toBe(200);
    const s = await res.json();
    expect(s).toMatchObject({ dryRun: true, group: 'would_create', memberships: { created: 3, existing: 0, removed: 0, collisions: [] } });
    expect(s.stamped.players).toBe(2);
    expect(await readGroup('bpm')).toBeUndefined();
    expect(getStore()['memberships'] ?? []).toEqual([]);
    expect((getStore()['players'] as { groupId?: string }[]).every((p) => p.groupId === undefined)).toBe(true);
  });

  it('creates the group from the owner’s settings, a membership per member, and stamps every row — then a second run does nothing', async () => {
    seedLegacyBpm();
    const me = (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
    me.skipDates = ['2026-12-25'];
    me.eTransferRecipient = { name: 'Grant', email: 'g@example.com' };
    me.createdAt = '2024-01-01T00:00:00Z';
    const lin = seedMember('Lin', { createdAt: '2025-01-01T00:00:00Z' });
    const gone = seedMember('Gone', { active: false });
    const res = await post({ dryRun: false }, { 'x-migration-key': KEY });
    expect(res.status).toBe(200);
    const s = await res.json();
    // created 1 / existing 1, not 2 / 0: step 1's `createGroup` mints the
    // OWNER's membership as part of creating the group, so step 2 finds it
    // already there. The three counts still add up to every Member.
    expect(s).toMatchObject({ dryRun: false, group: 'created', ownerMemberId: ADMIN_MEMBER_ID, memberships: { created: 1, existing: 1, removed: 1, collisions: [] }, errors: [] });
    expect(s.stamped).toMatchObject({ players: 2, sessions: 1, birds: 1, clubSettings: 1, kudos: 1 });

    const group = await readGroup('bpm');
    expect(group).toMatchObject({ id: 'bpm', ownerMemberId: ADMIN_MEMBER_ID, settings: { skipDates: ['2026-12-25'], eTransferRecipient: { name: 'Grant' }, maxPlayers: 12 } });
    expect((await readMembership('bpm', ADMIN_MEMBER_ID))).toMatchObject({ role: 'owner', joinedVia: 'backfill' });
    expect((await readMembership('bpm', lin.id))).toMatchObject({ role: 'member', status: 'active', joinedAt: '2025-01-01T00:00:00Z' });
    expect((await readMembership('bpm', gone.id))).toMatchObject({ status: 'removed' });
    // The removed person's name is FREE; the active ones are reserved.
    expect(await reserveRosterName('bpm', 'Gone', 'someone-new')).toBe(true);
    expect(await reserveRosterName('bpm', 'Lin', 'someone-new')).toBe(false);
    // Every row of every stamped container now carries the group.
    for (const c of STAMPED_CONTAINERS) {
      for (const row of (getStore()[c] ?? []) as { groupId?: string }[]) expect(row.groupId).toBe('bpm');
    }
    // With the flag on, the roster resolves through what the backfill wrote.
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    try {
      expect(await resolveActiveMemberId('bpm', 'lin')).toBe(lin.id);
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    }

    const again = await (await post({ dryRun: false }, { 'x-migration-key': KEY })).json();
    expect(again).toMatchObject({ group: 'exists', memberships: { created: 0, existing: 3, removed: 0, collisions: [] } });
    expect(Object.values(again.stamped as Record<string, number>).every((n) => n === 0)).toBe(true);
    const status = await (await GET(makeRequest('GET', url, undefined, asAdmin()))).json();
    expect(Object.values(status.unstamped as Record<string, number>).every((n) => n === 0)).toBe(true);
    expect(status.members.withoutMembership).toBe(0);
  });

  it('reports two ACTIVE members sharing a name as a collision and gives the later one no membership', async () => {
    const first = seedMember('Lin', { createdAt: '2025-01-01T00:00:00Z' });
    const second = seedMember('lin', { createdAt: '2025-06-01T00:00:00Z' });
    const s = await runBackfill({ dryRun: false });
    expect(s.memberships.collisions).toEqual([{ name: 'lin', memberIds: [first.id, second.id] }]);
    expect(await readMembership('bpm', first.id)).toBeDefined();
    expect(await readMembership('bpm', second.id)).toBeUndefined();
    expect(s.errors).toEqual([]);
    // The dry run sees the same collision without writing.
    resetMockStore(); await seedTestAdminMember({ membership: false });
    seedMember('Lin', { createdAt: '2025-01-01T00:00:00Z' }); seedMember('LIN', { createdAt: '2025-06-01T00:00:00Z' });
    const dry = await runBackfill({ dryRun: true });
    expect(dry.memberships.collisions).toHaveLength(1);
  });

  it('leaves a row edited between the read and the write alone, and counts it', async () => {
    seedDoc('birds', { id: 'b1', name: 'Yonex', tubes: 4, totalCost: 80, costPerTube: 20, date: '2026-09-01', _etag: 'etag-old' });
    const stale = { id: 'b1', _etag: 'etag-old' };
    // Someone edits the row after we read it.
    const live = (getStore()['birds'] as Record<string, unknown>[]).find((r) => r.id === 'b1')!;
    live.tubes = 3; live._etag = 'etag-new';
    expect(await stampRow('birds', stale)).toBe('conflict');
    expect(live.groupId).toBeUndefined();
    // Re-read, re-stamp: converges.
    expect(await stampRow('birds', { id: 'b1', _etag: 'etag-new' })).toBe('stamped');
    expect((getStore()['birds'][0] as { groupId?: string }).groupId).toBe('bpm');
  });

  it('stamps at most `limit` rows per container and says what is left', async () => {
    // The reason the limit exists: one request has 230s before Azure App
    // Service ends it, and `events` grows without a ceiling. So a run that
    // cannot finish must still RETURN, saying which containers to come back to.
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    for (const n of ['Lin', 'Viktor', 'Carolina']) seedPlayer('session-2026-09-03', n);
    seedMember('Lin');

    const first = await runBackfill({ dryRun: false, limit: 2 });
    expect(first.limit).toBe(2);
    expect(first.stamped.players).toBe(2);
    expect(first.remaining).toContain('players');
    expect((getStore()['players'] as { groupId?: string }[]).filter((p) => p.groupId === 'bpm')).toHaveLength(2);

    // The status read agrees with the summary about what is left.
    expect((await backfillStatus()).unstamped.players).toBe(1);

    const second = await runBackfill({ dryRun: false, limit: 2 });
    expect(second.stamped.players).toBe(1);
    expect(second.remaining).not.toContain('players');
    expect((await backfillStatus()).unstamped.players).toBe(0);
  });

  it('the BUDGET bounds the whole request, not each container — and names every container left', async () => {
    // The defect this closes: `limit` is per CONTAINER, and there are 13 of
    // them. 13 x 2000 is 26,000 rows at two round trips each, inside a 230s
    // window. The cap that was supposed to guarantee a report was the one
    // thing that could not bound the request.
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    for (const n of ['Lin', 'Viktor', 'Carolina']) seedPlayer('session-2026-09-03', n);
    seedAnnouncement('session-2026-09-03', 'one');
    seedAnnouncement('session-2026-09-03', 'two');

    // Generous per container, but only three rows may be touched in total.
    const run = await runBackfill({ dryRun: false, limit: 1000, budget: 3 });

    expect(run.budget).toBe(3);
    expect(run.stoppedEarly).toBe('budget');
    const total = Object.values(run.stamped).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);

    // Everything still carrying unstamped rows is named, including containers
    // this run never reached — `remaining` is the whole truth, not a prefix.
    const status = await backfillStatus();
    for (const [c, n] of Object.entries(status.unstamped)) {
      if (n > 0) expect(run.remaining).toContain(c);
    }

    // And it is resumable: a second run with room finishes the job.
    const second = await runBackfill({ dryRun: false, limit: 1000, budget: 1000 });
    expect(second.stoppedEarly).toBeNull();
    expect(second.remaining).toEqual([]);
    const after = await backfillStatus();
    expect(Object.values(after.unstamped).every((n) => n === 0)).toBe(true);
  });

  it('stops on the soft deadline and reports rather than running into the 504', async () => {
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    for (const n of ['Lin', 'Viktor', 'Carolina']) seedPlayer('session-2026-09-03', n);

    // A deadline already past: nothing may be stamped, and the operator still
    // gets a summary saying so. A 504 would say nothing at all.
    const run = await runBackfill({ dryRun: false, limit: 1000, deadlineMs: -1 });
    expect(run.stoppedEarly).toBe('deadline');
    expect(Object.values(run.stamped).reduce((a, b) => a + b, 0)).toBe(0);
    expect(run.remaining).toContain('players');
    expect((getStore()['players'] as { groupId?: string }[]).every((p) => p.groupId === undefined)).toBe(true);
  });

  it('stamps every row exactly once when they go out concurrently', async () => {
    // The pool runs 12 in flight; the guarantee is that concurrency changes
    // the timing and nothing else.
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    const names = Array.from({ length: 25 }, (_, i) => `P${i}`);
    for (const n of names) seedPlayer('session-2026-09-03', n);

    const run = await runBackfill({ dryRun: false, limit: 1000, budget: 1000 });
    expect(run.stamped.players).toBe(25);
    const rows = getStore()['players'] as { groupId?: string }[];
    expect(rows.filter((r) => r.groupId === 'bpm')).toHaveLength(25);
    expect((await backfillStatus()).unstamped.players).toBe(0);
  });

  it('a dry run is bounded the same way, and reports the same remainder', async () => {
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    for (const n of ['Lin', 'Viktor', 'Carolina']) seedPlayer('session-2026-09-03', n);
    const dry = await runBackfill({ dryRun: true, limit: 1 });
    expect(dry.stamped.players).toBe(1);
    expect(dry.remaining).toContain('players');
    expect((getStore()['players'] as { groupId?: string }[]).every((p) => p.groupId === undefined)).toBe(true);
  });

  it('collects a membership write failure instead of losing the whole summary', async () => {
    // A half-written membership from an interrupted run: the id is taken, but
    // the row carries no `groupId`, so the scoped point read cannot see it and
    // the create 409s. That must be ONE reported error, not a 500 that throws
    // away the report for everything the run already committed.
    const gone = seedMember('Gone', { active: false });
    seedMember('Lin');
    seedDoc('memberships', { id: `bpm:${gone.id}`, memberId: gone.id, name: 'Gone' });
    const s = await runBackfill({ dryRun: false });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain(gone.id);
    expect(s.memberships.removed).toBe(0);
    // Everyone else still got their membership, and the group still exists.
    expect(await readGroup('bpm')).toBeDefined();
    expect(s.memberships).toMatchObject({ created: 1, existing: 1 }); // Lin created; the owner's came with the group
  });

  it('picks the owner: ADMIN_NAMES first, else the earliest admin, else the earliest member', async () => {
    const a = seedMember('Zed', { role: 'admin', createdAt: '2025-02-01T00:00:00Z' });
    const b = seedMember('Amy', { role: 'admin', createdAt: '2025-01-01T00:00:00Z' });
    const c = seedMember('Old', { createdAt: '2024-01-01T00:00:00Z' });
    const members = getStore()['members'] as Parameters<typeof chooseOwner>[0];
    expect(chooseOwner(members.filter((m) => m.id !== ADMIN_MEMBER_ID))?.id).toBe(b.id);
    process.env.ADMIN_NAMES = 'zed';
    expect(chooseOwner(members)?.id).toBe(a.id);
    expect(chooseOwner([c])?.id).toBe(c.id);
    expect(chooseOwner([])).toBeNull();
  });

  it('with no members at all, refuses to invent an owner', async () => {
    resetMockStore();
    const s = await runBackfill({ dryRun: false });
    expect(s.group).toBe('absent'); // not 'exists' — there is no group, and that reads as success
    expect(s.errors[0]).toMatch(/no_members/);
    expect(await readGroup('bpm')).toBeUndefined();
  });

  it('a re-run fills settings the group doc never had, and touches nothing it has', async () => {
    const me = (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === ADMIN_MEMBER_ID)!;
    await runBackfill({ dryRun: false });
    expect((await readGroup('bpm'))?.settings.eTransferRecipient).toBeUndefined();
    me.eTransferRecipient = { name: 'Later', email: 'l@example.com' };
    me.skipDates = ['2027-01-01'];
    await runBackfill({ dryRun: false });
    expect((await readGroup('bpm'))?.settings).toMatchObject({ eTransferRecipient: { name: 'Later' }, skipDates: ['2027-01-01'] });
    me.eTransferRecipient = { name: 'Changed again', email: 'c@example.com' };
    await runBackfill({ dryRun: false });
    expect((await readGroup('bpm'))?.settings.eTransferRecipient).toMatchObject({ name: 'Later' });
    expect(await listMemberships('bpm')).toHaveLength(1);
  });
});

describe('drift between runs — the flag is OFF for the whole backfill window', () => {
  // With the flag off, POST /api/members reactivates a soft-deleted person and
  // DELETE soft-deletes one WITHOUT touching memberships: that half of the
  // route is gated on the flag. So a Member's `active` moves out from under
  // the membership an earlier run wrote, and a run that only creates what is
  // missing would leave it there for the cutover to trip over.

  it('rejoins a member restored between runs, and reserves their name again', async () => {
    const lin = seedMember('Lin', { active: false });
    const first = await runBackfill({ dryRun: false });
    expect(first.memberships).toMatchObject({ removed: 1, rejoined: 0 });
    expect((await readMembership('bpm', lin.id))?.status).toBe('removed');

    // An admin restores them, flag off, so nothing touches the membership.
    (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === lin.id)!.active = true;

    const second = await runBackfill({ dryRun: false });
    expect(second.memberships).toMatchObject({ rejoined: 1, created: 0, deactivated: 0 });
    expect((await readMembership('bpm', lin.id))?.status).toBe('active');
    // The name is theirs again — without this they are unresolvable the moment
    // the flag goes on, which is the whole failure this reconcile prevents.
    expect(await reserveRosterName('bpm', 'Lin', 'someone-else')).toBe(false);
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    try {
      expect(await resolveActiveMemberId('bpm', 'Lin')).toBe(lin.id);
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    }
  });

  it('takes a member soft-deleted between runs off the roster and frees their name', async () => {
    const lin = seedMember('Lin');
    await runBackfill({ dryRun: false });
    expect((await readMembership('bpm', lin.id))?.status).toBe('active');

    (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === lin.id)!.active = false;

    const second = await runBackfill({ dryRun: false });
    expect(second.memberships).toMatchObject({ deactivated: 1, rejoined: 0, removed: 0 });
    expect((await readMembership('bpm', lin.id))?.status).toBe('removed');
    expect(await reserveRosterName('bpm', 'Lin', 'someone-else')).toBe(true);
  });

  it('reports the drift in the status read — a membership ROW is not the gate', async () => {
    const lin = seedMember('Lin', { active: false });
    await runBackfill({ dryRun: false });
    expect((await backfillStatus()).members).toMatchObject({ withoutMembership: 0, mismatched: 0 });

    (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === lin.id)!.active = true;
    const drifted = await backfillStatus();
    // Everyone still HAS a membership; one of them is wrong. Zeros everywhere
    // else is exactly how this reads green without `mismatched`.
    expect(drifted.members).toMatchObject({ withoutMembership: 0, mismatched: 1 });

    await runBackfill({ dryRun: false });
    expect((await backfillStatus()).members.mismatched).toBe(0);
  });

  it('refuses to take the OWNER off the roster, and says why', async () => {
    await runBackfill({ dryRun: false });
    (getStore()['members'] as Record<string, unknown>[]).find((m) => m.id === ADMIN_MEMBER_ID)!.active = false;
    const s = await runBackfill({ dryRun: false });
    expect(s.memberships.deactivated).toBe(0);
    expect(s.errors[0]).toMatch(/owner .* reassign ownership/);
    expect((await readMembership('bpm', ADMIN_MEMBER_ID))?.status).toBe('active');
  });

  it('a dry run sees a collision against a reservation an interrupted run left behind', async () => {
    // The reservation exists with no membership beside it. Skipping the lookup
    // in dry-run mode made this invisible, so the dry run promised a clean run
    // and the real one reported a collision.
    const lin = seedMember('Lin');
    await reserveRosterName('bpm', 'Lin', 'someone-else');
    const dry = await runBackfill({ dryRun: true });
    expect(dry.memberships.collisions).toEqual([{ name: 'lin', memberIds: ['someone-else', lin.id] }]);
    expect(dry.memberships.created).toBe(1); // the admin owner only
  });

  it('does not count a membership it failed to write', async () => {
    // A half-written row from an interrupted run: the id is taken, but it
    // carries no `groupId`, so the scoped point read cannot see it and the
    // create 409s. Counting before the write reported a membership that is
    // not there.
    const lin = seedMember('Lin');
    seedDoc('memberships', { id: `bpm:${lin.id}`, memberId: lin.id, name: 'Lin' });
    const s = await runBackfill({ dryRun: false });
    // Nothing created: the owner's came with the group in step 1, and Lin's
    // write failed. Counting before the write reported Lin's as done.
    expect(s.memberships).toMatchObject({ created: 0, existing: 1 });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toContain(lin.id);
  });
});

describe('the status read is what the cutover is gated on', () => {
  it('caps a large count and says so, but zero is always exact', async () => {
    seedSession('session-2026-09-03', { datetime: '2026-09-03T19:00:00-07:00' });
    seedPlayer('session-2026-09-03', 'Lin');
    seedPlayer('session-2026-09-03', 'Viktor');
    const capped = await backfillStatus({ scanCap: 1 });
    expect(capped.unstamped.players).toBe(1); // "at least one"
    expect(capped.truncated).toContain('players');
    expect(capped.scanCap).toBe(1);
    // Nothing else is truncated, and an empty container reads a true zero.
    expect(capped.unstamped.birds).toBe(0);
    expect(capped.truncated).not.toContain('birds');
  });


  it('drops to zero only when every container is stamped', async () => {
    seedLegacyBpm();
    seedMember('Lin');
    await runBackfill({ dryRun: false });
    seedDoc('players', { id: 'late', name: 'Late', sessionId: 'session-2026-09-03', timestamp: 'x' });
    const status = await backfillStatus();
    expect(status.unstamped.players).toBe(1);
    await runBackfill({ dryRun: false });
    expect((await backfillStatus()).unstamped.players).toBe(0);
  });
});
