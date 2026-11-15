import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetMockStore, seedGroup, seedMember, seedMembership, getStore, ADMIN_MEMBER_ID, makeRequest } from './helpers';
import { sweepStrayAccounts, MAX_PURGES_PER_RUN } from '@/lib/strayAccounts';
import { runTick } from '@/lib/tick';
import { addAccountJoinRequest } from '@/lib/joinRequests';
import { rotateClaimLink } from '@/lib/claimLinks';
import { POST as SIGNUP } from '@/app/api/auth/signup/route';

/**
 * The 14-day cleanup (docs/plans/one-way-in.md, step 6). An account made in
 * no club, never let in and asking nowhere, is deleted 14 days on; anyone
 * who got into a club, is still asking, or was made before the mark existed
 * is left alone.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const NOW = Date.parse('2026-12-01T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const members = () => (getStore()['members'] ?? []) as Array<{ id: string; noClubSince?: string }>;
const exists = (id: string) => members().some((m) => m.id === id);

beforeEach(() => {
  resetMockStore();
  process.env[FLAG] = 'true';
  seedGroup('club-x', { ownerMemberId: ADMIN_MEMBER_ID, name: 'Six Feathers' });
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('sweepStrayAccounts', () => {
  it('deletes an account in no club past 14 days, and leaves a younger one', async () => {
    const old = seedMember('Stranger', { noClubSince: ago(15), email: 'stranger@example.com' });
    const young = seedMember('Newcomer', { noClubSince: ago(13) });
    const out = await sweepStrayAccounts(NOW);
    expect(out).toMatchObject({ checked: 1, purged: 1 });
    expect(exists(old.id)).toBe(false);
    expect(exists(young.id)).toBe(true);
  });

  it('never touches an account made before the mark existed', async () => {
    const legacy = seedMember('Old Timer', { createdAt: ago(400) });
    expect((await sweepStrayAccounts(NOW)).checked).toBe(0);
    expect(exists(legacy.id)).toBe(true);
  });

  it('an account that got into a club keeps its account and loses the mark', async () => {
    const lin = seedMember('Lin', { noClubSince: ago(20) });
    seedMembership('club-x', lin.id, { name: 'Lin' });
    expect(await sweepStrayAccounts(NOW)).toMatchObject({ cleared: 1, purged: 0 });
    expect(exists(lin.id)).toBe(true);
    expect(members().find((m) => m.id === lin.id)!.noClubSince).toBeUndefined();
  });

  it('a removed member once got in, and is not a stranger', async () => {
    const gone = seedMember('Gone', { noClubSince: ago(30) });
    seedMembership('club-x', gone.id, { name: 'Gone', status: 'removed' });
    expect((await sweepStrayAccounts(NOW)).purged).toBe(0);
    expect(exists(gone.id)).toBe(true);
  });

  it('an account still asking is kept until its ask lapses', async () => {
    const asker = seedMember('Asker', { noClubSince: ago(20) });
    // Asked again three days ago: the ask lives 14 days from then.
    await addAccountJoinRequest('club-x', asker.id, 'Asker', NOW - 3 * 24 * 60 * 60 * 1000);
    expect(await sweepStrayAccounts(NOW)).toMatchObject({ waiting: 1, purged: 0 });
    expect(exists(asker.id)).toBe(true);
    // Twelve days later the ask has lapsed, and so has the account.
    expect((await sweepStrayAccounts(NOW + 12 * 24 * 60 * 60 * 1000)).purged).toBe(1);
    expect(exists(asker.id)).toBe(false);
  });

  it('an account linked to an imported name (step 4b) goes at 14 days', async () => {
    const holder = seedMember('Viktor');
    seedMembership('club-x', holder.id, { name: 'Viktor' });
    const retired = seedMember('Viktor', { noClubSince: ago(15), active: false, mergedInto: holder.id, mergedInGroup: 'club-x' });
    expect((await sweepStrayAccounts(NOW)).purged).toBe(1);
    expect(exists(retired.id)).toBe(false);
    expect(exists(holder.id)).toBe(true);
  });

  it('is bounded per run', async () => {
    for (let i = 0; i < MAX_PURGES_PER_RUN + 3; i += 1) seedMember(`Ghost ${i}`, { noClubSince: ago(15) });
    expect((await sweepStrayAccounts(NOW)).purged).toBe(MAX_PURGES_PER_RUN);
    expect((await sweepStrayAccounts(NOW)).purged).toBe(3);
  });

  it('does nothing with groups off', async () => {
    delete process.env[FLAG];
    const old = seedMember('Stranger', { noClubSince: ago(15) });
    expect(await sweepStrayAccounts(NOW)).toEqual({ checked: 0, purged: 0, waiting: 0, cleared: 0 });
    expect(exists(old.id)).toBe(true);
  });
});

describe('the hourly tick runs it once, for the whole deployment', () => {
  it('reports counts only', async () => {
    seedMember('Stranger', { noClubSince: ago(15) });
    const run = await runTick(NOW, []);
    expect(run.jobs.strayAccounts).toEqual({ ok: 1, failed: 0, totals: { checked: 1, purged: 1, waiting: 0, cleared: 0 } });
  });
});

describe('new accounts carry the mark', () => {
  it('an account made to create a club is marked, so the sweep can find it', async () => {
    const res = await SIGNUP(
      makeRequest('POST', 'http://x/api/auth/signup', { name: 'Founder', email: 'founder@example.com', password: 'a good long password', noGroup: true }),
    );
    expect(res.status).toBe(201);
    const made = members().find((m) => (m as { name?: string }).name === 'Founder')!;
    expect(typeof made.noClubSince).toBe('string');
  });

  it('the club link is only a way in; it marks nothing on the link itself', async () => {
    // Guard against the sweep ever reading a club's own docs as accounts.
    await rotateClaimLink('club-x', ADMIN_MEMBER_ID);
    expect((await sweepStrayAccounts(NOW)).checked).toBe(0);
  });
});
