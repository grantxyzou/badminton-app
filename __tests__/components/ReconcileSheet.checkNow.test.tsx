// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ReconcileSheet from '@/components/admin/ledger/ReconcileSheet';

/**
 * #733: the Ledger check sheet shows WHICH failure "Check now" hit, from the
 * route's own answer, instead of one generic line.
 */
const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function mockPost(post: () => Promise<Response>) {
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return post();
    return new Response(JSON.stringify({ lastAt: null }), { status: 200 });
  }) as typeof fetch;
}

async function tapCheckNow() {
  render(<ReconcileSheet open onClose={() => {}} onChanged={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));
  return (await screen.findByRole('alert')).textContent ?? '';
}

describe('ReconcileSheet — Check now failures', () => {
  it('an expired admin sign-in says to sign in again', async () => {
    mockPost(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }));
    expect(await tapCheckNow()).toMatch(/sign in again.*\(401\)/);
  });

  it('a server-side failure says so and points at the log', async () => {
    mockPost(async () => new Response(JSON.stringify({ error: 'reconcile_failed' }), { status: 503 }));
    expect(await tapCheckNow()).toMatch(/server log.*\(503\)/);
  });

  it('no answer at all reads as a connection problem', async () => {
    mockPost(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await tapCheckNow()).toMatch(/Couldn't reach the server/);
  });
});
