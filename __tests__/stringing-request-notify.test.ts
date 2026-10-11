import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '../app/api/stringing/requests/route';
import { PATCH as SHOP } from '../app/api/stringing/shop/route';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  ADMIN_MEMBER_ID,
} from './helpers';
import { buildRequestPayload } from '../lib/pushMessages';

/**
 * A new request reaches the people who string (audit 2026-10-11, finding 04:
 * three unclaimed requests and a job two days late showed as "1 need you",
 * because nothing told anyone a request existed).
 *
 * Recipients are every `canString` member AND every admin of the group, minus
 * the requester (Grant: "All stringer"). The payload carries no spec and no
 * money — a lock screen is not the place for either.
 *
 * Mocks `@/lib/push` wholesale, as `stringing-push.test.ts` does: what matters
 * here is WHO was targeted and with WHAT, not the transport.
 */
type Payload = { title: string; body: string; url?: string; tag?: string };
const sendPushToMembers = vi.fn(async (_ids: string[], _p: Payload) => ({
  configured: true,
  sent: 1,
  failed: 0,
  removed: 0,
}));
vi.mock('@/lib/push', () => ({
  sendPushToMembers: (ids: string[], p: Payload) => sendPushToMembers(ids, p),
  sendPushToAll: vi.fn(async () => ({ configured: true, sent: 0, failed: 0, removed: 0 })),
  isPushConfigured: () => true,
  safeTag: (s: string | undefined) => s,
  ensurePushContainer: vi.fn(),
  hashEndpoint: (s: string) => s,
}));

const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];
const VALID = { racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 28 };

function requestAs(name: string, memberId: string) {
  return makeRequest('POST', 'http://x/api/stringing/requests', VALID, {
    Cookie: `member_session=${memberCookieValue(name, memberId)}`,
  });
}

function seedMember(id: string, name: string, extra: Record<string, unknown> = {}) {
  getStore().members.push({
    id,
    name,
    role: 'member',
    active: true,
    createdAt: new Date().toISOString(),
    ...extra,
  });
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
  sendPushToMembers.mockClear();
  await SHOP(makeAdminRequest('PATCH', 'http://x/api/stringing/shop', { open: true }));
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('a new request reaches the people who string', () => {
  it('pushes every canString member and every admin, never the requester', async () => {
    seedMember('m-lin', 'Lin', { canString: true });
    seedMember('m-zach', 'Zach', { canString: true });
    seedMember('m-sam', 'Sam');

    const res = await POST(requestAs('Lin', 'm-lin'));
    expect(res.status).toBe(201);

    expect(sendPushToMembers).toHaveBeenCalledTimes(1);
    const [ids, payload] = sendPushToMembers.mock.calls[0];
    expect(new Set(ids)).toEqual(new Set(['m-zach', ADMIN_MEMBER_ID]));
    // No tension, no string, no money on a lock screen.
    expect(payload.body).not.toMatch(/\$|lb|BG80|26/);
    expect(payload.body).toContain('Astrox 99 Pro');
    expect(payload.body).toContain('Lin');
  });

  it('sends nothing when nobody strings and no admin exists beyond the requester', async () => {
    seedMember('m-sam', 'Sam');
    // Demote the seeded admin so the only candidate is gone.
    const admin = getStore().members.find((m) => (m as { id: string }).id === ADMIN_MEMBER_ID) as { role: string };
    admin.role = 'member';
    const res = await POST(requestAs('Sam', 'm-sam'));
    expect(res.status).toBe(201);
    expect(sendPushToMembers).not.toHaveBeenCalled();
  });

  it('the request still succeeds when push throws', async () => {
    seedMember('m-lin', 'Lin');
    sendPushToMembers.mockRejectedValueOnce(new Error('push down'));
    const res = await POST(requestAs('Lin', 'm-lin'));
    expect(res.status).toBe(201);
  });
});

describe('buildRequestPayload', () => {
  it('names the player and racket, carries no spec, and opens the admin tab', () => {
    const p = buildRequestPayload({ jobNo: 'J-0007', memberName: 'Lin', racketLabel: 'Astrox 88D Pro' });
    expect(p.title).toBe('New stringing request');
    expect(p.body).toBe("Lin's Astrox 88D Pro is waiting on the bench.");
    expect(p.url).toMatch(/tab=admin/);
    expect(p.tag).toBe('str-J-0007-request');
  });

  it('falls back to "racket" when the label is blank', () => {
    const p = buildRequestPayload({ jobNo: 'J-0008', memberName: 'Lin', racketLabel: '  ' });
    expect(p.body).toBe("Lin's racket is waiting on the bench.");
  });
});
