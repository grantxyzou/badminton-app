// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { useInsight } from '../../lib/useInsight';
import { setIdentity, clearIdentity } from '../../lib/identity';

/**
 * `useInsight` memoizes one in-flight request per name across its three
 * consumers (the greeting and two chips), so mounting them must NOT produce
 * three calls. It also has to notice an identity change — it previously
 * subscribed to IDENTITY_EVENT only, never `storage`, so a sign-in in another
 * tab left it serving the departed member's insight.
 *
 * These two requirements pull against each other: the obvious way to honour
 * the second (clear the module cache whenever the name resolves) breaks the
 * first, because each consumer resolves on its own mount. The guard under test
 * clears only on an ACTUAL change, never on first observation.
 */

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
}

function Probe({ label }: { label: string }) {
  const { data } = useInsight(true);
  return <span data-testid={label}>{data?.greeting ?? '(none)'}</span>;
}

describe('useInsight — identity reactivity vs the shared memo', () => {
  let calls: string[];

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        const name = new URL(url, 'http://x').searchParams.get('name') ?? '';
        return jsonResponse({ account: true, greeting: `hi ${name}`, level: null, trend: null });
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    cleanup();
    clearIdentity();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('serves three consumers from one request', async () => {
    setIdentity({ name: 'Lin', token: 'tok', sessionId: 'session-2026-08-20' });

    render(
      <>
        <Probe label="a" />
        <Probe label="b" />
        <Probe label="c" />
      </>,
    );

    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('hi Lin'));
    expect(screen.getByTestId('b').textContent).toBe('hi Lin');
    expect(screen.getByTestId('c').textContent).toBe('hi Lin');

    // The whole reason this module exists. Clearing the cache on mount would
    // make this 3.
    expect(calls.filter((u) => u.includes('/api/stats/insight'))).toHaveLength(1);
  });

  it('refetches for the new member when the identity changes', async () => {
    setIdentity({ name: 'Lin', token: 'tok', sessionId: 'session-2026-08-20' });
    render(<Probe label="a" />);
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('hi Lin'));

    await act(async () => {
      setIdentity({ name: 'Viktor', token: 'tok2', sessionId: 'session-2026-08-20' });
    });

    // Not merely a re-render: the memo must have been invalidated, or Viktor
    // would be served Lin's cached insight.
    await waitFor(() => expect(screen.getByTestId('a').textContent).toBe('hi Viktor'));
    expect(calls.some((u) => u.includes('name=Viktor'))).toBe(true);
  });
});
