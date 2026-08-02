import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, getStore } from './helpers';

/**
 * `lib/push.ts` is the only place that talks to a push service. Two properties
 * matter most and are asserted here:
 *
 *  1. An unconfigured environment is a hard no-op — it must never load or call
 *     `web-push`. Every test run and local dev depends on this.
 *  2. 404/410 (subscription genuinely gone) deletes the doc; ANY other failure
 *     keeps it. Getting that backwards would silently unsubscribe live users on
 *     a transient 500.
 */

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

function configure() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
}

function unconfigure() {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
}

function seedSub(memberId: string, suffix: string) {
  const store = getStore();
  if (!store['pushSubscriptions']) store['pushSubscriptions'] = [];
  const doc = {
    id: `sub-${suffix}`,
    memberId,
    memberName: memberId,
    endpoint: `https://push.example.com/${suffix}`,
    endpointHash: `hash-${suffix}`,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  store['pushSubscriptions'].push(doc);
  return doc;
}

function subsInStore() {
  return (getStore()['pushSubscriptions'] ?? []) as { id: string; failureCount?: number }[];
}

/** Fresh module per test so the memoized container promise / vapid flag reset. */
async function loadPush() {
  vi.resetModules();
  return import('../lib/push');
}

describe('lib/push', () => {
  beforeEach(() => {
    resetMockStore();
    sendNotification.mockReset();
    setVapidDetails.mockReset();
    configure();
  });

  afterEach(() => {
    unconfigure();
  });

  describe('unconfigured environment', () => {
    it('sendPushToAll is a no-op and never calls web-push', async () => {
      unconfigure();
      seedSub('member-lin', 'a');
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result).toEqual({ configured: false, sent: 0, failed: 0, removed: 0 });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('sendPushToMembers is a no-op and never calls web-push', async () => {
      unconfigure();
      seedSub('member-lin', 'a');
      const { sendPushToMembers } = await loadPush();

      const result = await sendPushToMembers(['member-lin'], { title: 'x', body: 'y' });

      expect(result.configured).toBe(false);
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('isPushConfigured is false when only some vars are set', async () => {
      unconfigure();
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'only-public';
      const { isPushConfigured } = await loadPush();
      expect(isPushConfigured()).toBe(false);
    });
  });

  describe('delivery outcomes', () => {
    it('sends to every subscription and reports the count', async () => {
      seedSub('member-lin', 'a');
      seedSub('member-viktor', 'b');
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'Sign-ups are open', body: 'Tap in' });

      expect(result).toEqual({ configured: true, sent: 2, failed: 0, removed: 0 });
      expect(sendNotification).toHaveBeenCalledTimes(2);
    });

    it('deletes the subscription on 410 Gone and keeps the healthy one', async () => {
      seedSub('member-lin', 'dead');
      seedSub('member-viktor', 'live');
      sendNotification
        .mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }))
        .mockResolvedValueOnce({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result).toEqual({ configured: true, sent: 1, failed: 0, removed: 1 });
      const remaining = subsInStore().map((s) => s.id);
      expect(remaining).toEqual(['sub-live']);
    });

    it('deletes on 404 Not Found too', async () => {
      seedSub('member-lin', 'dead');
      sendNotification.mockRejectedValue(
        Object.assign(new Error('not found'), { statusCode: 404 }),
      );
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result.removed).toBe(1);
      expect(subsInStore()).toHaveLength(0);
    });

    it('KEEPS the subscription on a transient 500 and counts it failed', async () => {
      // The inverse of the 410 case — the property that stops a push-service
      // blip from silently unsubscribing everyone.
      seedSub('member-lin', 'flaky');
      sendNotification.mockRejectedValue(
        Object.assign(new Error('server error'), { statusCode: 500 }),
      );
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result).toEqual({ configured: true, sent: 0, failed: 1, removed: 0 });
      expect(subsInStore()).toHaveLength(1);
      expect(subsInStore()[0].failureCount).toBe(1);
    });

    it('keeps the subscription when the error carries no status code', async () => {
      seedSub('member-lin', 'netfail');
      sendNotification.mockRejectedValue(new Error('socket hang up'));
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result.failed).toBe(1);
      expect(result.removed).toBe(0);
      expect(subsInStore()).toHaveLength(1);
    });

    it('sendPushToMembers only targets the named members', async () => {
      seedSub('member-lin', 'lin');
      seedSub('member-viktor', 'viktor');
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToMembers } = await loadPush();

      const result = await sendPushToMembers(['member-lin'], { title: 'x', body: 'y' });

      expect(result.sent).toBe(1);
      expect(sendNotification).toHaveBeenCalledTimes(1);
      const [subscription] = sendNotification.mock.calls[0];
      expect((subscription as { endpoint: string }).endpoint).toContain('lin');
    });

    it('reports sent:0 with configured:true when nobody is subscribed', async () => {
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      const result = await sendPushToAll({ title: 'x', body: 'y' });

      expect(result).toEqual({ configured: true, sent: 0, failed: 0, removed: 0 });
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('payload hygiene', () => {
    it('truncates an over-long body so the 4KB payload cap cannot be blown', async () => {
      seedSub('member-lin', 'a');
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      await sendPushToAll({ title: 'x', body: 'z'.repeat(500) });

      const [, body] = sendNotification.mock.calls[0];
      const parsed = JSON.parse(body as string);
      expect(parsed.body.length).toBeLessThanOrEqual(160);
    });

    it('truncates an over-long title', async () => {
      seedSub('member-lin', 'a');
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      await sendPushToAll({ title: 'T'.repeat(200), body: 'ok' });

      const [, body] = sendNotification.mock.calls[0];
      expect(JSON.parse(body as string).title.length).toBeLessThanOrEqual(60);
    });

    it('passes the tag as a Topic collapse key', async () => {
      seedSub('member-lin', 'a');
      sendNotification.mockResolvedValue({ statusCode: 201 });
      const { sendPushToAll } = await loadPush();

      await sendPushToAll({ title: 'x', body: 'y', tag: 'signup-open-session-2026-08-06' });

      const [, , options] = sendNotification.mock.calls[0];
      expect((options as { topic?: string }).topic).toBe('signup-open-session-2026-08-06');
      expect((options as { TTL: number }).TTL).toBeGreaterThan(0);
    });

    it('safeTag strips unsafe characters and caps length', async () => {
      const { safeTag } = await loadPush();
      expect(safeTag('signup open/2026:08')).toBe('signup-open-2026-08');
      expect((safeTag('x'.repeat(100)) ?? '').length).toBeLessThanOrEqual(32);
      expect(safeTag(undefined)).toBeUndefined();
    });
  });
});
