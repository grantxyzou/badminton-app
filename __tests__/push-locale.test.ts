import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, getStore, setupAdminPin, makeRequest, memberCookieValue } from './helpers';
import type { PushSubscriptionDoc } from '../lib/types';

/**
 * A push is written in the reader's language (audit, 2026-11-05). It was
 * English for everyone: the service worker cannot translate, and nothing
 * recorded which language a device's app was in. Now each subscription
 * carries it — stamped when the device subscribes, refreshed when the member
 * switches language — and the send builds one payload per language.
 */
const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: () => undefined,
  },
}));

const BASE = 'http://localhost:3000/api/push/subscribe';
const subs = () => (getStore()['pushSubscriptions'] ?? []) as PushSubscriptionDoc[];
const validSub = (suffix: string) => ({
  endpoint: `https://push.example.com/send/${suffix}`,
  keys: { p256dh: 'BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5CW8OyNhLGkGZ8Nm9A', auth: 'tBHItJI5svbpez7KI4CCXg' },
});
const asLin = (method: 'POST' | 'PATCH', body: unknown, cookie = '') =>
  makeRequest(method, BASE, body as Record<string, unknown>, {
    Cookie: `member_session=${memberCookieValue('Lin', 'member-lin')}${cookie ? `; ${cookie}` : ''}`,
  });

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('the words', () => {
  it('Chinese for a Chinese reader, English unchanged for everyone else', async () => {
    const m = await import('../lib/pushMessages');
    expect(m.buildWaitlistPromotedPayload({ id: 's' }).title).toBe("You're in");
    expect(m.buildWaitlistPromotedPayload({ id: 's' }, 'zh-CN').title).toBe('你报上了');
    const ready = { key: 'ready_for_you', jobNo: 'J-0001', racketLabel: 'Astrox 99' } as Parameters<typeof m.buildStringingPayload>[0];
    expect(m.buildStringingPayload(ready, 'zh-CN')?.body).toBe('Astrox 99 — 可以来取了。');
    expect(m.buildReminderPayload(2, 'zh-CN').body).toBe('你有几次活动还没结账。');
    expect(m.buildPendingEditPayload({ jobNo: 'J-1' }).body).toBe('Something changed on your racket. Open BPM to have a look.');
  });

  it('names the session in the club’s clock, not the server’s', async () => {
    const m = await import('../lib/pushMessages');
    // An evening in Vancouver is the small hours of the next day in UTC —
    // what a UTC server printed. The hour is read from the zone's own rules
    // (BC's offset is the tz database's business, not this test's).
    const at = '2026-12-04T04:00:00Z';
    const body = m.buildSignupOpenPayload({ id: 's', datetime: at, locationName: 'Richmond' }).body;
    const local = new Intl.DateTimeFormat('en-CA', { weekday: 'short', hour: 'numeric', timeZone: 'America/Vancouver' }).format(new Date(at));
    expect(local.startsWith('Thu')).toBe(true);
    expect(body).toContain('Thu');
    expect(body).not.toContain('Fri');
  });
});

describe('the send', () => {
  it('builds one payload per language and hands each device its own', async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'pk';
    process.env.VAPID_PRIVATE_KEY = 'sk';
    process.env.VAPID_SUBJECT = 'mailto:t@example.com';
    const now = new Date().toISOString();
    const store = getStore();
    store['pushSubscriptions'] = [
      { id: 'a', memberId: 'm1', memberName: 'A', endpoint: 'https://push.example.com/a', endpointHash: 'ha', keys: { p256dh: 'p', auth: 'q' }, createdAt: now, lastSeenAt: now, locale: 'zh-CN' },
      { id: 'b', memberId: 'm2', memberName: 'B', endpoint: 'https://push.example.com/b', endpointHash: 'hb', keys: { p256dh: 'p', auth: 'q' }, createdAt: now, lastSeenAt: now },
    ];
    vi.resetModules();
    const { sendPushToMembers } = await import('../lib/push');
    const built: string[] = [];
    await sendPushToMembers(['m1', 'm2'], (locale) => {
      built.push(locale);
      return { title: locale === 'zh-CN' ? '你报上了' : "You're in", body: '.' };
    });
    expect(built.sort()).toEqual(['en', 'zh-CN']);
    const sentTo = Object.fromEntries(
      sendNotification.mock.calls.map(([sub, json]) => [(sub as { endpoint: string }).endpoint, JSON.parse(json as string).title]),
    );
    expect(sentTo['https://push.example.com/a']).toBe('你报上了');
    expect(sentTo['https://push.example.com/b']).toBe("You're in"); // no language recorded reads English
  });
});

describe('/api/push/subscribe records the language', () => {
  it('stamps the app’s language on a new device', async () => {
    const { POST } = await import('../app/api/push/subscribe/route');
    expect((await POST(asLin('POST', validSub('x'), 'NEXT_LOCALE=zh-CN'))).status).toBe(201);
    expect(subs()[0].locale).toBe('zh-CN');
  });

  it('a language switch updates every one of the member’s devices', async () => {
    const { POST, PATCH } = await import('../app/api/push/subscribe/route');
    await POST(asLin('POST', validSub('x')));
    await POST(asLin('POST', validSub('y')));
    expect(subs().map((s) => s.locale)).toEqual(['en', 'en']);
    const res = await PATCH(asLin('PATCH', { locale: 'zh-CN' }));
    expect(await res.json()).toEqual({ ok: true, updated: 2 });
    expect(subs().map((s) => s.locale)).toEqual(['zh-CN', 'zh-CN']);
  });

  it('refuses a stranger and a language it does not speak', async () => {
    const { PATCH } = await import('../app/api/push/subscribe/route');
    expect((await PATCH(makeRequest('PATCH', BASE, { locale: 'zh-CN' }))).status).toBe(401);
    expect((await PATCH(asLin('PATCH', { locale: 'fr' }))).status).toBe(400);
  });
});
