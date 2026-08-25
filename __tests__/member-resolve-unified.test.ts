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
