import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedMember,
  seedGroup,
  seedMembership,
  makeRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { GET as listGet } from '@/app/api/notifications/route';
import { POST as seenPost } from '@/app/api/notifications/seen/route';
import { recordNotices, NOTICE_KEEP, NOTICE_PAGE_SIZE } from '@/lib/notices';

/**
 * The Notifications page (docs/plans/notification-center.md).
 *
 * ONE PERSON, TWO CLUBS, as in group-isolation-sweep-2: Ana is a single Member
 * on both rosters, so her memberId matches notices in BOTH clubs and only the
 * group can separate them. Neither club is BPM, so nothing passes on the
 * fallback.
 */
const A = 'club-a';
const B = 'club-b';
const ANA = 'm-ana';
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';

const anaIn = (groupId: string) => `member_session=${memberCookieValue('Ana', ANA, 3600, groupId)}`;
const list = (groupId: string) => makeRequest('GET', 'http://localhost/api/notifications', undefined, { Cookie: anaIn(groupId) });
const seen = (groupId: string) => makeRequest('POST', 'http://localhost/api/notifications/seen', {}, { Cookie: anaIn(groupId) });

interface ListBody {
  notices: Array<{ type: string; text?: string; count?: number; at: string }>;
  unread: number;
  seenAt: string | null;
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember({ membership: false });
  seedMember('Ana', { id: ANA });
  process.env[FLAG] = 'true';
  for (const g of [A, B]) {
    seedGroup(g, { name: `Club ${g}`, ownerMemberId: ADMIN_MEMBER_ID });
    seedMembership(g, ANA, { name: 'Ana' });
  }
});

afterEach(() => {
  delete process.env[FLAG];
});

describe('GET /api/notifications', () => {
  it('lists only the club the cookie names, both directions', async () => {
    await recordNotices(A, [ANA], { type: 'announcement', text: 'Alpha **courts** moved' });
    await recordNotices(B, [ANA], { type: 'announcement', text: 'Beta nets are new' });

    const fromA = (await (await listGet(list(A))).json()) as ListBody;
    const fromB = (await (await listGet(list(B))).json()) as ListBody;
    // Vacuity guard: each club sees its OWN notice…
    expect(fromA.notices.map((n) => n.text)).toEqual(['Alpha courts moved']);
    expect(fromB.notices.map((n) => n.text)).toEqual(['Beta nets are new']);
    // …and none of the other's.
    expect(JSON.stringify(fromA)).not.toContain('Beta');
    expect(JSON.stringify(fromB)).not.toContain('Alpha');
  });

  it('refuses a signed-out caller', async () => {
    const res = await listGet(makeRequest('GET', 'http://localhost/api/notifications'));
    expect(res.status).toBe(401);
  });

  it('counts everything unread until the page is opened, then nothing until something new', async () => {
    await recordNotices(A, [ANA], { type: 'signups_open', sessionAt: '2026-11-05T19:00:00-08:00' });
    await recordNotices(A, [ANA], { type: 'settle_up', count: 2 });
    expect(((await (await listGet(list(A))).json()) as ListBody).unread).toBe(2);

    const stamp = await seenPost(seen(A));
    expect(stamp.status).toBe(200);
    const after = (await (await listGet(list(A))).json()) as ListBody;
    expect(after.unread).toBe(0);
    expect(after.seenAt).not.toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    await recordNotices(A, [ANA], { type: 'promoted' });
    expect(((await (await listGet(list(A))).json()) as ListBody).unread).toBe(1);
    // Seen in club A says nothing about club B.
    await recordNotices(B, [ANA], { type: 'promoted' });
    expect(((await (await listGet(list(B))).json()) as ListBody).unread).toBe(1);
  });

  it('carries no amount on a settle-up notice', async () => {
    await recordNotices(A, [ANA], { type: 'settle_up', count: 3 });
    const body = (await (await listGet(list(A))).json()) as ListBody;
    expect(body.notices[0]).toMatchObject({ type: 'settle_up', count: 3 });
    expect(JSON.stringify(body.notices[0])).not.toMatch(/\$|amount|owed/i);
  });

  it('shows the newest page and trims what is past the keep line', async () => {
    for (let i = 0; i < NOTICE_KEEP + 5; i++) {
      await recordNotices(A, [ANA], { type: 'announcement', text: `n${i}` });
      await new Promise((r) => setTimeout(r, 1));
    }
    const body = (await (await listGet(list(A))).json()) as ListBody;
    expect(body.notices).toHaveLength(NOTICE_PAGE_SIZE);
    expect(body.notices[0].text).toBe(`n${NOTICE_KEEP + 4}`);
    await new Promise((r) => setTimeout(r, 10));
    const left = (getStore()['insights'] ?? []).filter((d) => (d as { kind?: string }).kind === 'notice');
    expect(left).toHaveLength(NOTICE_KEEP);
  });
});

describe('recordNotices', () => {
  it('writes one notice per distinct recipient and never throws on junk', async () => {
    const n = await recordNotices(A, [ANA, ANA, '', 'm-other'], { type: 'promoted' });
    expect(n).toBe(2);
    await expect(recordNotices(A, [], { type: 'promoted' })).resolves.toBe(0);
  });
});
