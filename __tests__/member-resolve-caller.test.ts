import { describe, it, expect, beforeEach } from 'vitest';
import { resolveActiveSubject, resolveActiveMemberId } from '@/lib/memberResolve';
import { resetMockStore, seedMember } from './helpers';

/**
 * The caller shortcut (performance audit, 2026-10-19). Every Stats read
 * resolves the name it is asked about, and with groups off that was a
 * case-insensitive scan of every member — six of them on one Stats mount. When
 * the signed-in member asks about THEMSELVES, the cookie already names them, so
 * one point read answers it.
 *
 * The hint may only NARROW: it is taken when the read finds an active member
 * whose stored name is the one asked about, and otherwise the scan runs exactly
 * as before. Two active members sharing a name tell the paths apart: the scan
 * answers with whichever comes first, the shortcut with the caller.
 */
describe('resolveActiveSubject / resolveActiveMemberId with a caller hint', () => {
  beforeEach(() => resetMockStore());

  it('a member asking about themselves resolves to themselves', async () => {
    const first = seedMember('Lin', { id: 'member-lin-a', active: true });
    const second = seedMember('Lin', { id: 'member-lin-b', active: true });

    // No hint: the scan's first match.
    expect((await resolveActiveSubject('bpm', 'Lin')).memberId).toBe(first.id);
    // The caller is the second Lin: the shortcut answers with them.
    expect((await resolveActiveSubject('bpm', 'Lin', { memberId: second.id, name: 'Lin' })).memberId).toBe(second.id);
    expect(await resolveActiveMemberId('bpm', 'lin', { memberId: second.id, name: 'LIN' })).toBe(second.id);
  });

  it('asking about someone else ignores the hint and scans', async () => {
    const viktor = seedMember('Viktor', { id: 'member-viktor', active: true });
    seedMember('Lin', { id: 'member-lin', active: true });
    expect(await resolveActiveMemberId('bpm', 'Viktor', { memberId: 'member-lin', name: 'Lin' })).toBe(viktor.id);
  });

  it('a caller renamed since signing in falls back to the scan for the asked-for name', async () => {
    // The cookie still says "Lin"; the stored name is now "Lin Dan".
    seedMember('Lin Dan', { id: 'member-lindan', active: true });
    const other = seedMember('Lin', { id: 'member-other-lin', active: true });
    expect(await resolveActiveMemberId('bpm', 'Lin', { memberId: 'member-lindan', name: 'Lin' })).toBe(other.id);
  });

  it('a removed caller is never resolved through the shortcut', async () => {
    seedMember('Kento', { id: 'member-kento', active: false });
    expect(await resolveActiveMemberId('bpm', 'Kento', { memberId: 'member-kento', name: 'Kento' })).toBeNull();
    expect((await resolveActiveSubject('bpm', 'Kento', { memberId: 'member-kento', name: 'Kento' })).memberId).toBe('name:kento');
  });

  it('a cookie naming a member that no longer exists falls back to the scan', async () => {
    const akane = seedMember('Akane', { id: 'member-akane-new', active: true });
    expect(await resolveActiveMemberId('bpm', 'Akane', { memberId: 'member-akane-gone', name: 'Akane' })).toBe(akane.id);
  });
});
