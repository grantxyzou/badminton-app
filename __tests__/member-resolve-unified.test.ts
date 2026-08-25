import { describe, it, expect, beforeEach } from 'vitest';
import { resolveActiveSubject, resolveActiveMemberId } from '@/lib/memberResolve';
import { resetMockStore, seedMember } from './helpers';

/**
 * The unification: every name-keyed route resolves the ACTIVE row.
 *
 * Before this, six routes (level, drills, drills/done, club/bands, assessments,
 * kudos) resolved UNFILTERED while three (recommend, equipment/gear,
 * stats/insight) filtered on `active = true`. For a name whose only row is
 * soft-deleted the two disagreed: unfiltered returned that row's real id,
 * filtered fell through to `name:<lower>`. `recommend` and `stats/insight` then
 * read `assessments` at the filtered id while `assessments` were WRITTEN at the
 * unfiltered one — a straddle that is closed by construction once both sides
 * use the same resolver.
 *
 * Gated on a read-only production audit (2026-08-25): 68 member rows, 0
 * duplicate name groups, 0 rows with `active` undefined, 15 inactive of which 9
 * are test fixtures and the remaining 6 hold no assessments and no level — so
 * nothing existed to orphan.
 */
describe('member resolution is active-only and agrees across routes', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('resolves an active member to their real id', async () => {
    const lin = seedMember('Lin', { active: true });
    const s = await resolveActiveSubject('Lin');
    expect(s.memberId).toBe(lin.id);
    expect(s.isMember).toBe(true);
  });

  it('does NOT resolve a soft-deleted member — it falls through to the name id', async () => {
    // The disagreement set: a name whose ONLY row is inactive. Unfiltered would
    // have returned 'm-gone' here, so drills/assessments/kudos wrote there while
    // gear/recommend wrote at `name:gone`.
    seedMember('Gone', { active: false });
    const s = await resolveActiveSubject('Gone');
    expect(s.memberId).toBe('name:gone');
    expect(s.isMember).toBe(false);
  });

  it('agrees with the id-only variant, which returns null instead of a fallback', async () => {
    seedMember('Gone', { active: false });
    // Same filter, different contract: gear must NOT invent an id, or it starts
    // writing bag documents at `gear-name:gone`.
    expect(await resolveActiveMemberId('Gone')).toBeNull();
    const lin = seedMember('Lin', { active: true });
    expect(await resolveActiveMemberId('Lin')).toBe(lin.id);
  });

  it('is case- and whitespace-insensitive on the way in, and preserves the given name', async () => {
    const lin = seedMember('Lin', { active: true });
    const s = await resolveActiveSubject('  lIN  ');
    expect(s.memberId).toBe(lin.id);
    expect(s.name).toBe('lIN');
  });

  it('falls back rather than throwing when the members read fails', async () => {
    // Read-only surfaces must degrade, not 500.
    const s = await resolveActiveSubject('Nobody');
    expect(s.memberId).toBe('name:nobody');
    expect(s.isMember).toBe(false);
  });
});

/**
 * The two vectors that could re-create duplicate rows.
 *
 * The production audit came back with 0 duplicate name groups, which is what
 * made the active-only flip a provable no-op. Both of these would have decayed
 * that result silently — no error, just a second row with the same name, after
 * which a cross-partition `LOWER(c.name)` query with no ORDER BY picks between
 * them for an id that keys drills, assessments, kudos and gear.
 */
describe('duplicate-member vectors are closed', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('A: signing up a soft-deleted name REACTIVATES rather than creating a second row', async () => {
    // The sign-up lookup filters `active = true`, so the soft-deleted row is
    // invisible to it and the admin-bypass branch used to create a duplicate.
    const gone = seedMember('Gone', { active: false });
    const { POST } = await import('@/app/api/players/route');
    const { makeRequest, seedPointer, seedSession, setupAdminPin, adminCookieValue, getStore } = await import('./helpers');
    setupAdminPin();
    seedPointer('session-2026-08-27');
    seedSession('session-2026-08-27', { signupOpen: true, maxPlayers: 12 });

    await POST(makeRequest('POST', 'http://t/api/players', { name: 'Gone' }, {
      Cookie: `admin_session=${adminCookieValue()}`,
    }));

    const rows = ((getStore()['members'] ?? []) as Array<{ id: string; name?: string; active?: boolean }>)
      .filter((m) => String(m.name).toLowerCase() === 'gone');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(gone.id);
    expect(rows[0].active).toBe(true);
  });
});
