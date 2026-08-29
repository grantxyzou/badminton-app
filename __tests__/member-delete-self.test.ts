import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedPointer,
  setupAdminPin,
  memberCookieValue,
  makeRequest,
} from './helpers';
import { getContainer } from '@/lib/cosmos';
import { TOMBSTONE_NAME, TOMBSTONE_MEMBER_ID } from '@/lib/memberPurge';
import { DELETE } from '@/app/api/members/me/route';

/**
 * DELETE /api/members/me — "delete my account".
 *
 * Required by App Store Guideline 5.1.1(v) and by PIPEDA independently of it.
 * The rule the whole thing rests on: REMOVE THE PERSON, KEEP EVERYONE ELSE'S
 * RECORDS CORRECT. A `players` row is one line of a cost split and a
 * `gameResults` row holds four names — deleting either rewrites history that
 * belongs to other people, so those are anonymized while genuinely personal
 * data is destroyed.
 */
const URL_ME = 'http://localhost:3000/api/members/me';
const MEMBER_ID = 'member-wei';

function del(body: Record<string, unknown> = { confirm: true }, authed = true) {
  const headers = authed
    ? { Cookie: `member_session=${memberCookieValue('Wei', MEMBER_ID)}` }
    : undefined;
  return DELETE(makeRequest('DELETE', URL_ME, body, headers));
}

function rows(container: string): Record<string, unknown>[] {
  return (getStore()[container] ?? []) as Record<string, unknown>[];
}

beforeEach(async () => {
  resetMockStore();
  // Sets SESSION_SECRET — without it the app signs with a dev sentinel and the
  // helper's member cookie never verifies.
  setupAdminPin();
  seedPointer('session-2026-09-03');

  await getContainer('members').items.upsert({
    id: MEMBER_ID,
    name: 'Wei',
    active: true,
    email: 'wei@example.com',
    pinHash: 'scrypt$whatever',
  });

  // A past session (money already settled) and the active one (a live seat).
  await getContainer('players').items.upsert({
    id: 'p-past',
    sessionId: 'session-2026-08-14',
    name: 'Wei',
    memberId: MEMBER_ID,
    deleteToken: 'tok-past',
    paid: true,
  });
  await getContainer('players').items.upsert({
    id: 'p-active',
    sessionId: 'session-2026-09-03',
    name: 'Wei',
    memberId: MEMBER_ID,
    deleteToken: 'tok-active',
  });

  await getContainer('gameResults').items.upsert({
    id: 'g1',
    sessionId: 'session-2026-08-14',
    teamA: ['Wei', 'Lin'],
    teamB: ['Kento', 'Sindhu'],
    scoreA: 21,
    scoreB: 18,
    loggedBy: 'Wei',
    loggedAt: '2026-08-14T00:00:00.000Z',
  });

  await getContainer('kudos').items.upsert({
    id: 'k-received',
    recipientMemberId: MEMBER_ID,
    recipientName: 'Wei',
    raterMemberId: 'member-lin',
    raterName: 'Lin',
    sessionId: 'session-2026-08-14',
    tag: 'great_partner',
  });
  await getContainer('kudos').items.upsert({
    id: 'k-given',
    recipientMemberId: 'member-lin',
    recipientName: 'Lin',
    raterMemberId: MEMBER_ID,
    raterName: 'Wei',
    sessionId: 'session-2026-08-14',
    tag: 'great_partner',
  });

  await getContainer('playerGear').items.upsert({ id: `gear-${MEMBER_ID}`, memberId: MEMBER_ID });
  await getContainer('pushSubscriptions').items.upsert({
    id: 'sub-1',
    memberId: MEMBER_ID,
    endpoint: 'https://push.example/x',
  });
  await getContainer('identities').items.upsert({
    id: 'google:123',
    memberId: MEMBER_ID,
    provider: 'google',
  });
  await getContainer('aliases').items.upsert({ id: 'a1', memberId: MEMBER_ID, name: 'Wei' });
  await getContainer('skills').items.upsert({
    id: 's1',
    sessionId: 'session-2026-08-14',
    name: 'Wei',
    scores: {},
  });
  await getContainer('feedback').items.create({
    id: 'r1',
    message: 'button is broken',
    name: 'Wei',
    ip: '203.0.113.9',
  });
});

describe('the gates', () => {
  it('refuses without a member cookie — names are enumerable', async () => {
    const res = await del({ confirm: true }, false);
    expect(res.status).toBe(401);
    expect(rows('members')).toHaveLength(1);
  });

  it('refuses without an explicit confirmation', async () => {
    const res = await del({});
    expect(res.status).toBe(400);
    expect(rows('members')).toHaveLength(1);
  });
});

describe('what survives, and in what shape', () => {
  it('deletes the member row itself', async () => {
    expect((await del()).status).toBe(200);
    expect(rows('members')).toHaveLength(0);
  });

  /** The decision this feature turns on. */
  it('KEEPS the past session row, so other people’s split still balances', async () => {
    await del();
    const past = rows('players').find((p) => p.id === 'p-past');
    expect(past).toBeDefined();
    expect(past!.name).toBe(TOMBSTONE_NAME);
    expect(past!.paid).toBe(true);
  });

  it('strips the credentials off the row it keeps', async () => {
    await del();
    const past = rows('players').find((p) => p.id === 'p-past')!;
    // A deleteToken on an anonymized row is a live credential for a dead
    // account; memberId is what would make it re-linkable.
    expect(past.deleteToken).toBeUndefined();
    expect(past.memberId).toBeUndefined();
  });

  it('frees the seat in the ACTIVE session rather than anonymizing it', async () => {
    // Keeping a ghost in Thursday's roster would hold a real person on the
    // waitlist.
    await del();
    const active = rows('players').find((p) => p.id === 'p-active')!;
    expect(active.removed).toBe(true);
    expect(active.name).toBe(TOMBSTONE_NAME);
  });

  it('rewrites the name in a game instead of deleting three other records', async () => {
    await del();
    const game = rows('gameResults').find((g) => g.id === 'g1');
    expect(game).toBeDefined();
    expect(game!.teamA).toEqual([TOMBSTONE_NAME, 'Lin']);
    expect(game!.teamB).toEqual(['Kento', 'Sindhu']);
    expect(game!.loggedBy).toBe(TOMBSTONE_NAME);
  });

  it('keeps a kudos they GAVE — the recipient earned it — but not their name', async () => {
    await del();
    const given = rows('kudos').find((k) => k.id === 'k-given');
    expect(given).toBeDefined();
    expect(given!.raterName).toBe(TOMBSTONE_NAME);
    expect(given!.raterMemberId).toBe(TOMBSTONE_MEMBER_ID);
  });

  it('anonymizes a problem report without losing the report', async () => {
    await del();
    const report = rows('feedback').find((f) => f.id === 'r1');
    expect(report).toBeDefined();
    expect(report!.message).toBe('button is broken');
    expect(report!.name).toBe(TOMBSTONE_NAME);
    expect(report!.ip).toBeUndefined();
  });
});

describe('what is destroyed', () => {
  it.each([
    ['playerGear'],
    ['pushSubscriptions'],
    ['identities'],
    ['aliases'],
    ['skills'],
  ])('purges %s outright', async (container) => {
    await del();
    expect(rows(container)).toHaveLength(0);
  });

  it('deletes a kudos they RECEIVED — that one is about them', async () => {
    await del();
    expect(rows('kudos').find((k) => k.id === 'k-received')).toBeUndefined();
  });

  it('reports what it did rather than a bare success', async () => {
    const res = await del();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBeGreaterThan(0);
    expect(body.anonymized).toBeGreaterThan(0);
    expect(body.spotsFreed).toBe(1);
    // A partial delete the user is never told about is the lying-empty-state
    // rule wearing a different hat.
    expect(body.failed).toEqual([]);
  });

  it('signs the device out', async () => {
    const res = await del();
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('member_session=');
  });
});
