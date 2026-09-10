import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedGroup,
  seedMembership,
  seedSession,
  makeRequest,
  memberCookieValue,
  setupAdminPin,
} from './helpers';
import { POST as recover } from '@/app/api/players/recover/route';
import { signInCandidates, MAX_SIGNIN_CANDIDATES } from '@/lib/memberResolve';
import { explicitGroupId } from '@/lib/groupContext';
import { hashPin } from '@/lib/recoveryHash';

/**
 * SIGNING IN WHEN A NAME IS NOT A PERSON.
 *
 * One club made `members[0]` unambiguous. With groups on, two clubs can each
 * have a Lin, and the PIN is the only thing that tells them apart. The rule:
 * verify EVERY candidate, sign in on EXACTLY ONE match, and answer every other
 * outcome the same way — a distinct "which one?" would be an oracle saying two
 * accounts share a PIN.
 */
const url = 'http://x/api/players/recover';
const SESSION = 'session-2026-09-03';
let ip = 0;

/** A member with a PIN, on one group's roster, with their name reserved there. */
async function seedPerson(groupId: string, name: string, pin: string, opts: { joinedAt?: string } = {}) {
  const member = seedMember(name, { pinHash: await hashPin(pin) });
  // `seedMembership` writes the name reservation with the row, the way
  // `addMembership` does — a membership without one is a shape the app cannot
  // produce, and a name resolves through the reservation.
  seedMembership(groupId, member.id, { name, joinedAt: opts.joinedAt ?? '2026-01-01T00:00:00.000Z' });
  return member;
}

const post = (body: Record<string, unknown>, cookie?: string) =>
  recover(makeRequest('POST', url, body, { 'X-Client-IP': `10.5.0.${++ip}`, ...(cookie ? { Cookie: cookie } : {}) }));

beforeEach(() => {
  resetMockStore();
  // Mints the SESSION_SECRET the cookie helpers sign with. Without it every
  // claim silently fails to verify and every request reads as no-context —
  // which is a PASSING no-context test for the wrong reason.
  setupAdminPin();
  seedSession(SESSION, { datetime: '2026-09-03T19:00:00-07:00' });
  seedGroup('bpm');
  seedGroup('other');
  process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
});

describe('no group context — the exactly-one rule', () => {
  it('signs in the one Lin whose PIN matches, and mints a session in HER club', async () => {
    const bpmLin = await seedPerson('bpm', 'Lin', '1111');
    const otherLin = await seedPerson('other', 'Lin', '2222');

    const res = await post({ name: 'Lin', sessionId: SESSION, pin: '2222' });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    // The cookie must name the group the matching person is actually in —
    // landing them in BPM because BPM is the default would sign them into a
    // club they have never been a member of.
    const payload = JSON.parse(
      Buffer.from(decodeURIComponent(cookie.split('member_session=')[1].split('.')[0].split(';')[0]), 'base64url').toString('utf8'),
    );
    expect(payload.memberId).toBe(otherLin.id);
    expect(payload.groupId).toBe('other');
    expect(payload.memberId).not.toBe(bpmLin.id);
  });

  it('refuses when two people share BOTH the name and the PIN, and says nothing about why', async () => {
    await seedPerson('bpm', 'Lin', '1111');
    await seedPerson('other', 'Lin', '1111');

    const res = await post({ name: 'Lin', sessionId: SESSION, pin: '1111' });
    expect(res.status).toBe(401);
    // The SAME body as a wrong PIN. A distinct "ambiguous" answer would tell an
    // attacker that a second account exists AND shares this PIN.
    expect(await res.json()).toEqual({ error: 'invalid_credentials' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('is not confused by ONE person on two rosters under the same name', async () => {
    // Two memberships, one member, one PIN match. Treating this as ambiguous
    // would lock somebody out of their own account.
    const lin = seedMember('Lin', { pinHash: await hashPin('1111') });
    for (const [g, joinedAt] of [['other', '2024-05-01T00:00:00.000Z'], ['bpm', '2026-01-01T00:00:00.000Z']] as const) {
      seedMembership(g, lin.id, { name: 'Lin', joinedAt });
    }
    const res = await post({ name: 'Lin', sessionId: SESSION, pin: '1111' });
    expect(res.status).toBe(200);
    // The OLDEST membership wins: the club they have been in longest is the
    // least surprising landing, and Phase 3's switcher moves them.
    const { candidates } = await signInCandidates('Lin', null);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].groupId).toBe('other');
  });

  it('refuses past the candidate cap instead of verifying an unbounded list', async () => {
    // Every candidate costs one scrypt verification, which is deliberately
    // slow. Unbounded, a common first name is a way to spend a B1 tier's CPU
    // from an unauthenticated endpoint.
    for (let i = 0; i <= MAX_SIGNIN_CANDIDATES; i++) {
      seedGroup(`g${i}`);
      await seedPerson(`g${i}`, 'Lin', '1111');
    }
    const over = await signInCandidates('Lin', null);
    expect(over.candidates).toEqual([]);
    expect(over.overCap).toBe(MAX_SIGNIN_CANDIDATES + 1);
    expect((await post({ name: 'Lin', sessionId: SESSION, pin: '1111' })).status).toBe(401);
  });

  it('ignores a removed membership — a name released is not a way in', async () => {
    const lin = await seedPerson('bpm', 'Lin', '1111');
    const rows = getStore()['memberships'] as Record<string, unknown>[];
    rows.find((r) => r.id === `bpm:${lin.id}`)!.status = 'removed';
    const { candidates } = await signInCandidates('Lin', null);
    expect(candidates).toEqual([]);
    expect((await post({ name: 'Lin', sessionId: SESSION, pin: '1111' })).status).toBe(401);
  });
});

describe('with group context, the claim decides', () => {
  it('resolves the Lin of the CLAIMED group even when another club has one too', async () => {
    const bpmLin = await seedPerson('bpm', 'Lin', '1111');
    await seedPerson('other', 'Lin', '2222');
    const cookie = `member_session=${memberCookieValue('Someone', 'member-someone', 60 * 60, 'bpm')}`;

    // BPM's Lin has PIN 1111; the other club's has 2222. Under a BPM claim,
    // 2222 must NOT sign anybody in — that person is not on this roster.
    expect((await post({ name: 'Lin', sessionId: SESSION, pin: '2222' }, cookie)).status).toBe(401);
    const ok = await post({ name: 'Lin', sessionId: SESSION, pin: '1111' }, cookie);
    expect(ok.status).toBe(200);
    const { candidates } = await signInCandidates('Lin', 'bpm');
    expect(candidates.map((c) => c.member.id)).toEqual([bpmLin.id]);
  });
});

describe('flag off, nothing moves', () => {
  it('resolves the members scan and never reaches the cross-group search', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    const lin = seedMember('Lin', { pinHash: await hashPin('1111') });
    // A membership in another club, which flag-off must not consult at all.
    seedMembership('other', 'someone-else', { name: 'Lin' });

    const { candidates } = await signInCandidates('Lin', null);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].member.id).toBe(lin.id);
    expect(candidates[0].groupId).toBe('bpm');
    expect((await post({ name: 'Lin', sessionId: SESSION, pin: '1111' })).status).toBe(200);
  });

  it('explicitGroupId is null flag-off, even with a claim on the cookie', () => {
    delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    const req = makeRequest('GET', 'http://x/', undefined, {
      Cookie: `member_session=${memberCookieValue('Lin', 'member-lin', 3600, 'other')}`,
    });
    expect(explicitGroupId(req)).toBeNull();
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    expect(explicitGroupId(req)).toBe('other');
  });

  it('reads a PRE-CLAIM cookie as BPM context, not as an absence of one', () => {
    // A cookie minted before the claim existed is a real signed-in session,
    // and every other route reads it as BPM. Sending it down the cross-group
    // search instead would let a legacy BPM device sign in as somebody else's
    // Lin. "No context" means no verifiable cookie at all.
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    const req = makeRequest('GET', 'http://x/', undefined, {
      Cookie: `member_session=${memberCookieValue('Lin', 'member-lin', 3600, null)}`,
    });
    expect(explicitGroupId(req)).toBe('bpm');
    expect(explicitGroupId(makeRequest('GET', 'http://x/'))).toBeNull();
  });
});
