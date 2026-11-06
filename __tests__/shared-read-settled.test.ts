// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Opening the app asked the server 35 times, ten of them twice: the tabs
 * opened behind the launch screen re-read what Home had read a second before
 * (measured 2026-11-05). A LANDED answer is now reused for a few seconds —
 * but only while the page has written nothing since, so a refetch after a
 * sign-up, a payment or a PIN change still goes to the server.
 */
let calls: Array<{ url: string; method: string }>;
let status = 200;

beforeEach(() => {
  vi.resetModules();
  calls = [];
  status = 200;
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() });
    return new Response(JSON.stringify({ n: calls.length }), { status });
  });
  vi.stubGlobal('fetch', mock);
  window.fetch = mock as unknown as typeof fetch;
});
afterEach(() => vi.unstubAllGlobals());

const reads = () => calls.filter((c) => c.method === 'GET').length;

describe('sharedFetch reuses a landed answer only while nothing was written', () => {
  it('without the write watch, a second read after the first landed goes to the server', async () => {
    const { sharedFetch } = await import('../lib/sharedRead');
    await sharedFetch('/api/members');
    await sharedFetch('/api/members');
    expect(reads()).toBe(2);
  });

  it('with the watch, a tab opened a moment later gets the same answer without asking again', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    const a = await (await sharedFetch('/api/members')).json();
    const b = await (await sharedFetch('/api/members')).json();
    expect(reads()).toBe(1);
    expect(b).toEqual(a);
  });

  it('any write in between sends the next read to the server', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    await sharedFetch('/api/players');
    await window.fetch('/bpm/api/players', { method: 'POST', body: '{}' });
    await sharedFetch('/api/players');
    expect(reads()).toBe(2);
  });

  it('a write that started while the read was in flight also voids it', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    const pending = sharedFetch('/api/players');
    void window.fetch('/bpm/api/players', { method: 'PATCH', body: '{}' });
    await pending;
    await sharedFetch('/api/players');
    expect(reads()).toBe(2);
  });

  it('a refused or failed answer is never handed to a later caller', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    status = 503;
    await sharedFetch('/api/session');
    status = 200;
    const r = await sharedFetch('/api/session');
    expect(r.status).toBe(200);
    expect(reads()).toBe(2);
  });

  it('expires after a few seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
      watchWrites();
      await sharedFetch('/api/releases');
      vi.setSystemTime(Date.now() + 9000);
      await sharedFetch('/api/releases');
      expect(reads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a page whose fetch was replaced after the watch (a test double) reuses nothing', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    await sharedFetch('/api/members');
    const replaced = vi.fn(async () => new Response('{}', { status: 200 }));
    window.fetch = replaced as unknown as typeof fetch;
    vi.stubGlobal('fetch', replaced);
    await sharedFetch('/api/members');
    expect(replaced).toHaveBeenCalledTimes(1);
  });
});

describe('the usage beacons are not writes', () => {
  it('an app_open or tab_view beacon does not void a landed answer', async () => {
    const { sharedFetch, watchWrites } = await import('../lib/sharedRead');
    watchWrites();
    await sharedFetch('/api/members');
    await window.fetch('/bpm/api/events', { method: 'POST', body: '{"kind":"tab_view"}' });
    await sharedFetch('/api/members');
    expect(reads()).toBe(1);
  });
});
