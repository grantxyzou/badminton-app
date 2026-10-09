import { describe, it, expect } from 'vitest';
import { isDormant, isNewMember, DORMANT_DAYS } from '@/lib/dormant';

/**
 * Nobody is dormant until they have been a member for DORMANT_DAYS (Grant,
 * 2026-10-09): a new organiser saw "1 need you" — themselves — on day one.
 */
const NOW = Date.parse('2026-10-09T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('isDormant', () => {
  it('a member who joined today and has never played is not dormant', () => {
    expect(isDormant({ sessionCount: 0, joinedAt: daysAgo(0) }, NOW)).toBe(false);
    expect(isNewMember({ joinedAt: daysAgo(0) }, NOW)).toBe(true);
  });

  it('the grace runs out at the window: never played after 61 days is dormant', () => {
    expect(isDormant({ sessionCount: 0, joinedAt: daysAgo(DORMANT_DAYS - 1) }, NOW)).toBe(false);
    expect(isDormant({ sessionCount: 0, joinedAt: daysAgo(DORMANT_DAYS + 1) }, NOW)).toBe(true);
  });

  it("the GROUP's join date wins over the account's age", () => {
    // An old account that joined this group last week is still new here.
    expect(isDormant({ sessionCount: 0, createdAt: daysAgo(400), joinedAt: daysAgo(7) }, NOW)).toBe(false);
    // Without a group join date the account's own age decides.
    expect(isDormant({ sessionCount: 0, createdAt: daysAgo(400) }, NOW)).toBe(true);
    expect(isDormant({ sessionCount: 0, createdAt: daysAgo(3) }, NOW)).toBe(false);
  });

  it('keeps the old rule past the grace: not seen in the window is dormant, seen recently is not', () => {
    expect(isDormant({ sessionCount: 4, lastSeen: daysAgo(90), joinedAt: daysAgo(300) }, NOW)).toBe(true);
    expect(isDormant({ sessionCount: 4, lastSeen: daysAgo(10), joinedAt: daysAgo(300) }, NOW)).toBe(false);
  });

  it('no join date at all means no grace, and an inactive member is never counted', () => {
    expect(isDormant({ sessionCount: 0 }, NOW)).toBe(true);
    expect(isDormant({ active: false, sessionCount: 0 }, NOW)).toBe(false);
  });
});

describe('GET /api/members sends the group join date to admins only', () => {
  it('admin rows carry joinedAt from the membership; a member sees name, active and avatar alone', async () => {
    const h = await import('./helpers');
    const { GET } = await import('@/app/api/members/route');
    h.resetMockStore();
    h.setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP = 'true';
    try {
      await h.seedTestAdminMember({ membership: false });
      h.seedGroup('club-a', { name: 'A', ownerMemberId: h.ADMIN_MEMBER_ID });
      h.seedMembership('club-a', h.ADMIN_MEMBER_ID, { name: 'Org', role: 'owner' });
      h.seedMember('Ana', { id: 'm-ana', createdAt: '2025-01-01T00:00:00Z' });
      h.seedMembership('club-a', 'm-ana', { name: 'Ana', joinedAt: '2026-10-08T00:00:00Z' });

      const admin = await GET(h.makeRequest('GET', 'http://x/api/members', undefined, {
        Cookie: `admin_session=${h.adminCookieValue({ groupId: 'club-a' })}`,
      }));
      const rows = (await admin.json()) as Array<{ name: string; joinedAt?: string }>;
      expect(rows.find((r) => r.name === 'Ana')?.joinedAt).toBe('2026-10-08T00:00:00Z');

      const member = await GET(h.makeRequest('GET', 'http://x/api/members', undefined, {
        Cookie: `member_session=${h.memberCookieValue('Ana', 'm-ana', 3600, 'club-a')}`,
      }));
      const seen = (await member.json()) as Array<Record<string, unknown>>;
      expect(seen.length).toBeGreaterThan(0);
      for (const r of seen) expect(Object.keys(r).sort()).toEqual(['active', 'avatar', 'name']);
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_MULTI_GROUP;
    }
  });
});
