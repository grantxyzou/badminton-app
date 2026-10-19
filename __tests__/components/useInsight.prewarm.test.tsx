// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useInsight, prewarmInsight } from '../../lib/useInsight';
import { setIdentity, clearIdentity } from '../../lib/identity';

/**
 * Home warms the insight so Stats opens with it ready. The warm-up used to be
 * a raw `fetch` the memo never saw, so Stats asked a second time — two
 * requests against the route's 30-per-hour limit for one answer (performance
 * audit, 2026-10-19). `prewarmInsight` puts the request in the same memo.
 *
 * And a warm-up that FAILS must not be the answer Stats gets: before, Stats
 * always made its own request, so a brief failure at launch had healed by the
 * time anyone opened the tab.
 */

function Intl({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={{}}>{children}</NextIntlClientProvider>;
}

function Probe() {
  const { data, error } = useInsight(true);
  return <span data-testid="p">{error ? '(error)' : (data?.greeting ?? '(none)')}</span>;
}

const insightCalls = (calls: string[]) => calls.filter((u) => u.includes('/api/stats/insight'));

describe('prewarmInsight', () => {
  let calls: string[];

  beforeEach(() => {
    localStorage.clear();
    calls = [];
  });

  afterEach(() => {
    cleanup();
    clearIdentity();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('the Stats cards reuse the warm-up instead of asking again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ account: true, greeting: 'hi Akane', trend: null }) } as Response);
      }) as unknown as typeof fetch,
    );
    setIdentity({ name: 'Akane', token: 'tok', sessionId: 'session-2026-10-21' });

    prewarmInsight('Akane', 'en');
    render(<Intl><Probe /></Intl>);

    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('hi Akane'));
    expect(insightCalls(calls)).toHaveLength(1);
  });

  it('a failed warm-up is forgotten, so Stats asks for itself', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        calls.push(String(input));
        n += 1;
        // The warm-up meets a brief outage; by the time Stats opens it is over.
        if (n === 1) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ account: true, greeting: 'hi Sindhu', trend: null }) } as Response);
      }) as unknown as typeof fetch,
    );
    setIdentity({ name: 'Sindhu', token: 'tok', sessionId: 'session-2026-10-21' });

    prewarmInsight('Sindhu', 'en');
    // Let the failed warm-up settle and be dropped before Stats mounts.
    await waitFor(() => expect(insightCalls(calls)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));

    render(<Intl><Probe /></Intl>);
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('hi Sindhu'));
    expect(insightCalls(calls)).toHaveLength(2);
  });
});
