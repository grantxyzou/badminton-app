import { describe, it, expect, beforeEach, vi } from 'vitest';

const push = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(),
}));

vi.mock('../lib/push', () => ({
  isPushConfigured: () => push.configured,
  sendPushToMembers: push.send,
}));

import { POST } from '../app/api/push/test/route';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeRequest,
  makeAdminRequest,
  ADMIN_MEMBER_ID,
  memberCookieValue,
} from './helpers';

const URL = 'http://localhost:3000/api/push/test';

describe('POST /api/push/test', () => {
  beforeEach(async () => {
    resetMockStore();
    setupAdminPin();
    await seedTestAdminMember();
    push.configured = true;
    push.send.mockReset();
    push.send.mockResolvedValue({ configured: true, sent: 1, failed: 0, removed: 0 });
  });

  it('refuses an anonymous caller and sends nothing', async () => {
    const res = await POST(makeRequest('POST', URL));
    expect(res.status).toBe(401);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('refuses a signed-in non-admin member', async () => {
    const cookie = `member_session=${memberCookieValue('Lin', 'member-lin')}`;
    const res = await POST(makeRequest('POST', URL, undefined, { Cookie: cookie }));
    expect(res.status).toBe(401);
    expect(push.send).not.toHaveBeenCalled();
  });

  it('answers 503 push_not_configured when no transport is set up', async () => {
    push.configured = false;
    const res = await POST(makeAdminRequest('POST', URL));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('push_not_configured');
    expect(push.send).not.toHaveBeenCalled();
  });

  it("sends only to the calling admin's own devices and returns the result", async () => {
    const res = await POST(makeAdminRequest('POST', URL));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, configured: true, sent: 1, failed: 0, removed: 0 });
    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.send.mock.calls[0][0]).toEqual([ADMIN_MEMBER_ID]);
  });

  it('answers 500 send_failed when the sender throws', async () => {
    push.send.mockRejectedValue(new Error('boom'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeAdminRequest('POST', URL));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('send_failed');
  });

  it('rate limits per IP before checking auth', async () => {
    const headers = { 'X-Client-IP': 'push-test-flood' };
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await POST(makeRequest('POST', URL, undefined, headers))).status;
    }
    expect(last).toBe(429);
  });
});
