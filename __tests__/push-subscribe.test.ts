import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST, DELETE } from '../app/api/push/subscribe/route';
import { resetMockStore, getStore, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import type { PushSubscriptionDoc } from '../lib/types';

const BASE = 'http://localhost:3000/api/push/subscribe';

function validSub(suffix = 'abc') {
  return {
    endpoint: `https://push.example.com/send/${suffix}`,
    keys: {
      p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5CW8OyNhLGkGZ8Nm9A',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };
}

function postAs(name: string, body: unknown, memberId?: string) {
  const cookie = `member_session=${memberCookieValue(name, memberId)}`;
  return makeRequest('POST', BASE, body as Record<string, unknown>, { Cookie: cookie });
}

function deleteAs(name: string, body: unknown, memberId?: string) {
  const cookie = `member_session=${memberCookieValue(name, memberId)}`;
  return makeRequest('DELETE', BASE, body as Record<string, unknown>, { Cookie: cookie });
}

function subs(): PushSubscriptionDoc[] {
  return (getStore()['pushSubscriptions'] ?? []) as PushSubscriptionDoc[];
}

describe('/api/push/subscribe', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
  });

  describe('flag gating', () => {
    it('POST 404s when the flag is off', async () => {
      delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
      const res = await POST(postAs('Lin', validSub()));
      expect(res.status).toBe(404);
      process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
    });

    it('DELETE 404s when the flag is off', async () => {
      delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
      const res = await DELETE(deleteAs('Lin', { endpoint: validSub().endpoint }));
      expect(res.status).toBe(404);
      process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
    });
  });

  describe('auth', () => {
    it('rejects an anonymous POST', async () => {
      const res = await POST(makeRequest('POST', BASE, validSub()));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('auth_required');
      expect(subs()).toHaveLength(0);
    });

    it('rejects an anonymous DELETE', async () => {
      const res = await DELETE(makeRequest('DELETE', BASE, { endpoint: 'https://x.example/y' }));
      expect(res.status).toBe(401);
    });

    it('IGNORES a body-supplied memberId and binds to the cookie (rule 12)', async () => {
      // Member names are enumerable via GET /api/members. If the body could
      // name the owner, anyone could register a device against another member
      // and receive their targeted notifications.
      const res = await POST(
        postAs('Lin', { ...validSub(), memberId: 'member-viktor' }, 'member-lin'),
      );
      expect(res.status).toBe(201);
      expect(subs()).toHaveLength(1);
      expect(subs()[0].memberId).toBe('member-lin');
    });
  });

  describe('validation', () => {
    it('rejects a non-https endpoint', async () => {
      const res = await POST(postAs('Lin', { ...validSub(), endpoint: 'http://push.example.com/x' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_subscription');
    });

    it('rejects an oversized endpoint', async () => {
      const res = await POST(
        postAs('Lin', { ...validSub(), endpoint: `https://push.example.com/${'x'.repeat(1200)}` }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a missing p256dh key', async () => {
      const res = await POST(postAs('Lin', { endpoint: validSub().endpoint, keys: { auth: 'tBHItJI5svbpez7KI4CCXg' } }));
      expect(res.status).toBe(400);
    });

    it('rejects a non-base64url key', async () => {
      const res = await POST(
        postAs('Lin', { ...validSub(), keys: { p256dh: 'not valid!! keys @@@', auth: 'tBHItJI5svbpez7KI4CCXg' } }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects a garbage body', async () => {
      const res = await POST(postAs('Lin', { nonsense: true }));
      expect(res.status).toBe(400);
      expect(subs()).toHaveLength(0);
    });
  });

  describe('subscribe', () => {
    it('creates a subscription bound to the caller', async () => {
      const res = await POST(postAs('Lin', validSub(), 'member-lin'));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });

      expect(subs()).toHaveLength(1);
      const doc = subs()[0];
      expect(doc.memberId).toBe('member-lin');
      expect(doc.memberName).toBe('Lin');
      expect(doc.endpointHash).toHaveLength(64);
      expect(doc.createdAt).toBeTruthy();
    });

    it('never echoes the endpoint back to the client', async () => {
      const res = await POST(postAs('Lin', validSub()));
      const bodyText = JSON.stringify(await res.json());
      expect(bodyText).not.toContain('push.example.com');
    });

    it('refreshes rather than duplicating when the same device re-subscribes', async () => {
      await POST(postAs('Lin', validSub('same'), 'member-lin'));
      const first = subs()[0].lastSeenAt;

      const res = await POST(postAs('Lin', validSub('same'), 'member-lin'));
      expect(res.status).toBe(200);
      expect((await res.json()).refreshed).toBe(true);
      expect(subs()).toHaveLength(1);
      expect(subs()[0].lastSeenAt >= first).toBe(true);
    });

    it('keeps separate docs for two devices of the same member', async () => {
      await POST(postAs('Lin', validSub('phone'), 'member-lin'));
      await POST(postAs('Lin', validSub('laptop'), 'member-lin'));
      expect(subs()).toHaveLength(2);
      expect(new Set(subs().map((s) => s.memberId))).toEqual(new Set(['member-lin']));
    });

    it('evicts the oldest device beyond the 10-device cap', async () => {
      for (let i = 0; i < 11; i++) {
        await POST(postAs('Lin', validSub(`device-${i}`), 'member-lin'));
      }
      expect(subs()).toHaveLength(10);
      // The very first device is the one that should have been dropped.
      // `endpoint` is optional on the doc since native tokens landed; every
      // doc here is web, so an empty string is the right "absent".
      const endpoints = subs().map((s) => s.endpoint ?? '');
      expect(endpoints.some((e) => e.endsWith('device-0'))).toBe(false);
      expect(endpoints.some((e) => e.endsWith('device-10'))).toBe(true);
    });
  });

  describe('unsubscribe', () => {
    it('removes the caller-owned subscription', async () => {
      await POST(postAs('Lin', validSub('mine'), 'member-lin'));
      expect(subs()).toHaveLength(1);

      const res = await DELETE(deleteAs('Lin', { endpoint: validSub('mine').endpoint }, 'member-lin'));
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBe(1);
      expect(subs()).toHaveLength(0);
    });

    it('is idempotent when nothing matches', async () => {
      const res = await DELETE(deleteAs('Lin', { endpoint: 'https://push.example.com/never' }));
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBe(0);
    });

    it("cannot delete another member's device even knowing its endpoint", async () => {
      await POST(postAs('Viktor', validSub('viktors-phone'), 'member-viktor'));
      expect(subs()).toHaveLength(1);

      const res = await DELETE(
        deleteAs('Lin', { endpoint: validSub('viktors-phone').endpoint }, 'member-lin'),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).removed).toBe(0);
      // Viktor's device survives.
      expect(subs()).toHaveLength(1);
      expect(subs()[0].memberId).toBe('member-viktor');
    });
  });

  describe('rate limiting', () => {
    it('429s past the hourly cap for one IP', async () => {
      // makeRequest assigns a UNIQUE X-Client-IP per call, so the limiter is
      // never exercised unless we pin the IP explicitly.
      const cookie = `member_session=${memberCookieValue('Lin', 'member-lin')}`;
      const headers = { Cookie: cookie, 'X-Client-IP': 'push-ratelimit-probe' };

      let sawLimit = false;
      for (let i = 0; i < 25; i++) {
        const res = await POST(
          makeRequest('POST', BASE, validSub(`rl-${i}`) as unknown as Record<string, unknown>, headers),
        );
        if (res.status === 429) {
          sawLimit = true;
          expect((await res.json()).error).toBe('rate_limited');
          break;
        }
      }
      expect(sawLimit).toBe(true);
    });
  });
});
