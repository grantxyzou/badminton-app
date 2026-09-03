import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { resetMockStore, getStore, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import type { PushSubscriptionDoc } from '../lib/types';

/**
 * The native shell registers `{ platform, token }` against the SAME
 * `/api/push/subscribe` and the SAME container as the web PWA, and
 * `lib/push.ts` fans out by platform. Three things are pinned here:
 *
 *  1. The subscribe route accepts a native token, dedupes on it, and DELETEs
 *     by it — and still accepts the unchanged web shape (a body with no
 *     `platform` is web; that is every doc written before native existed).
 *  2. A mixed roster sends on both transports, and an arm whose transport is
 *     unconfigured is SKIPPED, not counted failed.
 *  3. FCM `gone` deletes the doc; a 5xx keeps it — the web arm's rule, kept.
 */
const BASE = 'http://localhost:3000/api/push/subscribe';
const TOKEN = 'dGVzdA:APA91b' + 'H'.repeat(120);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  project_id: 'bpm-test',
  client_email: 'fcm@bpm-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
};

function validWeb(suffix = 'abc') {
  return {
    endpoint: `https://push.example.com/send/${suffix}`,
    keys: {
      p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5CW8OyNhLGkGZ8Nm9A',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };
}

function as(method: 'POST' | 'DELETE', name: string, body: unknown) {
  const cookie = `member_session=${memberCookieValue(name)}`;
  return makeRequest(method, BASE, body as Record<string, unknown>, { Cookie: cookie });
}

function subs(): PushSubscriptionDoc[] {
  return (getStore()['pushSubscriptions'] ?? []) as PushSubscriptionDoc[];
}

describe('/api/push/subscribe — native tokens', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY = 'true';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_PUSH_NOTIFY;
  });

  it('stores an ios token with platform, no endpoint, hashed like an endpoint', async () => {
    const { POST } = await import('../app/api/push/subscribe/route');
    const res = await POST(as('POST', 'Lin', { platform: 'ios', token: TOKEN }));
    expect(res.status).toBe(201);
    const [doc] = subs();
    expect(doc).toMatchObject({ platform: 'ios', token: TOKEN, memberName: 'Lin' });
    expect(doc!.endpoint).toBeUndefined();
    expect(doc!.keys).toBeUndefined();
    expect(doc!.endpointHash).toMatch(/^[0-9a-f]{64}$/);
    // Never echoed back.
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });

  it('re-POSTing the same token refreshes rather than duplicating', async () => {
    const { POST } = await import('../app/api/push/subscribe/route');
    await POST(as('POST', 'Lin', { platform: 'android', token: TOKEN }));
    const res = await POST(as('POST', 'Lin', { platform: 'android', token: TOKEN }));
    expect((await res.json()).refreshed).toBe(true);
    expect(subs()).toHaveLength(1);
  });

  it('rejects malformed native bodies', async () => {
    const { POST } = await import('../app/api/push/subscribe/route');
    for (const body of [
      { platform: 'ios' },
      { platform: 'ios', token: 'short' },
      { platform: 'ios', token: 'has spaces ' + 'x'.repeat(30) },
      { platform: 'windows', token: TOKEN },
      // Both shapes at once is a guess, not a subscription.
      { platform: 'ios', token: TOKEN, ...validWeb() },
      { ...validWeb(), token: TOKEN },
    ]) {
      const res = await POST(as('POST', 'Lin', body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(subs()).toHaveLength(0);
  });

  it('still accepts the unchanged web shape with no platform', async () => {
    const { POST } = await import('../app/api/push/subscribe/route');
    const res = await POST(as('POST', 'Lin', validWeb()));
    expect(res.status).toBe(201);
    expect(subs()[0]!.platform).toBeUndefined();
    expect(subs()[0]!.endpoint).toBe(validWeb().endpoint);
  });

  it('DELETE by token removes the native doc and is scoped to the member', async () => {
    const { POST, DELETE } = await import('../app/api/push/subscribe/route');
    await POST(as('POST', 'Lin', { platform: 'ios', token: TOKEN }));
    // Someone else holding the token string cannot remove it.
    const other = await DELETE(as('DELETE', 'Viktor', { token: TOKEN }));
    expect((await other.json()).removed).toBe(0);
    expect(subs()).toHaveLength(1);

    const res = await DELETE(as('DELETE', 'Lin', { token: TOKEN }));
    expect((await res.json()).removed).toBe(1);
    expect(subs()).toHaveLength(0);
  });

  it('DELETE with both endpoint and token is rejected', async () => {
    const { DELETE } = await import('../app/api/push/subscribe/route');
    const res = await DELETE(as('DELETE', 'Lin', { token: TOKEN, endpoint: 'https://x/y' }));
    expect(res.status).toBe(400);
  });
});

/* ---------- fan-out ---------- */

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: () => undefined,
  },
}));

function seedWeb(memberId: string, suffix: string) {
  const store = getStore();
  if (!store['pushSubscriptions']) store['pushSubscriptions'] = [];
  store['pushSubscriptions'].push({
    id: `web-${suffix}`,
    memberId,
    memberName: memberId,
    endpoint: `https://push.example.com/${suffix}`,
    endpointHash: `hash-${suffix}`,
    keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
}

function seedNative(memberId: string, suffix: string, platform: 'ios' | 'android' = 'ios') {
  const store = getStore();
  if (!store['pushSubscriptions']) store['pushSubscriptions'] = [];
  store['pushSubscriptions'].push({
    id: `native-${suffix}`,
    memberId,
    memberName: memberId,
    platform,
    token: `token-${suffix}-${'x'.repeat(40)}`,
    endpointHash: `hash-native-${suffix}`,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  });
}

function ids() {
  return subs().map((s) => s.id).sort();
}

function configureWeb() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:t@example.com';
}

type FcmAnswer = () => Response;
let fcmSend: FcmAnswer;

async function loadPush() {
  vi.resetModules();
  return import('../lib/push');
}

describe('lib/push — platform fan-out', () => {
  beforeEach(() => {
    resetMockStore();
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    fcmSend = () => new Response(JSON.stringify({ name: 'ok' }), { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('oauth2')
          ? new Response(JSON.stringify({ access_token: 'ya29', expires_in: 3600 }), { status: 200 })
          : fcmSend(),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  });

  it('sends a mixed roster on both transports', async () => {
    configureWeb();
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
    seedWeb('lin', 'a');
    seedNative('viktor', 'b', 'ios');
    seedNative('akane', 'c', 'android');
    const { sendPushToAll } = await loadPush();

    const result = await sendPushToAll({ title: 'Sign-ups are open', body: 'Tap in', tag: 'signup' });

    expect(result).toEqual({ configured: true, sent: 3, failed: 0, removed: 0 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const fcmCalls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.filter(([u]) => u.includes('messages:send'));
    expect(fcmCalls).toHaveLength(2);
  });

  it('skips native devices when FCM is unconfigured — not failed, and web still goes', async () => {
    configureWeb();
    seedWeb('lin', 'a');
    seedNative('viktor', 'b');
    const { sendPushToAll } = await loadPush();
    const result = await sendPushToAll({ title: 'x', body: 'y' });
    expect(result).toEqual({ configured: true, sent: 1, failed: 0, removed: 0 });
    expect(ids()).toEqual(['native-b', 'web-a']);
  });

  it('skips web devices when VAPID is unconfigured — native still goes', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
    seedWeb('lin', 'a');
    seedNative('viktor', 'b');
    const { sendPushToAll, isPushConfigured } = await loadPush();
    expect(isPushConfigured()).toBe(true);
    const result = await sendPushToAll({ title: 'x', body: 'y' });
    expect(result).toEqual({ configured: true, sent: 1, failed: 0, removed: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('is unconfigured when neither transport is set, even with native docs', async () => {
    seedNative('viktor', 'b');
    const { sendPushToAll } = await loadPush();
    expect(await sendPushToAll({ title: 'x', body: 'y' })).toEqual({ configured: false, sent: 0, failed: 0, removed: 0 });
  });

  it('deletes a native doc on UNREGISTERED and keeps the rest', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
    seedNative('viktor', 'dead');
    seedNative('akane', 'live');
    let n = 0;
    fcmSend = () =>
      n++ === 0
        ? new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 })
        : new Response(JSON.stringify({ name: 'ok' }), { status: 200 });
    const { sendPushToAll } = await loadPush();

    const result = await sendPushToAll({ title: 'x', body: 'y' });
    expect(result).toEqual({ configured: true, sent: 1, failed: 0, removed: 1 });
    expect(ids()).toEqual(['native-live']);
  });

  it('KEEPS a native doc on a 503 and counts it failed', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
    seedNative('viktor', 'flaky');
    fcmSend = () => new Response(JSON.stringify({ error: { status: 'UNAVAILABLE' } }), { status: 503 });
    const { sendPushToAll } = await loadPush();

    const result = await sendPushToAll({ title: 'x', body: 'y' });
    expect(result).toEqual({ configured: true, sent: 0, failed: 1, removed: 0 });
    expect(ids()).toEqual(['native-flaky']);
    expect(subs()[0]!.failureCount).toBe(1);
  });

  it('truncates title and body once, for both transports', async () => {
    configureWeb();
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SA);
    seedWeb('lin', 'a');
    seedNative('viktor', 'b');
    const { sendPushToAll } = await loadPush();
    await sendPushToAll({ title: 'T'.repeat(100), body: 'B'.repeat(300) });

    const webBody = JSON.parse(sendNotification.mock.calls[0]![1] as string);
    expect(webBody.title.length).toBe(60);
    expect(webBody.body.length).toBe(160);
    const fcmCall = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => u.includes('messages:send'))!;
    const { message } = JSON.parse(String(fcmCall[1].body));
    expect(message.notification.title).toBe(webBody.title);
    expect(message.notification.body).toBe(webBody.body);
  });
});
