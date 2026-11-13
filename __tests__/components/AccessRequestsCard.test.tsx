// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AccessRequestsCard from '@/components/admin/CommandCenter/AccessRequestsCard';

/**
 * The inbox card's join rows (docs/plans/door-link.md): people asking to JOIN
 * through the club's door link. Only an organiser lets them in.
 */
function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

const JOIN = { joinRequestId: 'j1', name: 'Akane', at: 1, nameTaken: false };
const TAKEN = { joinRequestId: 'j2', name: 'Viktor', at: 2, nameTaken: true };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccessRequestsCard: joins', () => {
  it.each([
    ['a regular', /Let Akane in as a regular/, true],
    ['a drop-in', /Let Akane in as a drop-in/, false],
  ])('an organiser lets a new person in as %s; the approve names the request and says which', async (_label, button, regular) => {
    const fetchMock = vi.fn((_u: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST' ? json({ ok: true }) : json({ requests: [], joins: [JOIN], organiser: true }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<AccessRequestsCard />);
    expect(await screen.findByText('Akane')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ joinRequestId: 'j1', decision: 'approve', regular });
  });

  it('a taken name offers Ignore only, and says why', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ requests: [], joins: [TAKEN], organiser: true })));
    render(<AccessRequestsCard />);
    expect(await screen.findByText(/already has that name/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Let Viktor in/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ignore' })).toBeDefined();
  });

  it('an admin who is not an organiser sees the ask with no buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ requests: [], joins: [JOIN], organiser: false })));
    render(<AccessRequestsCard />);
    expect(await screen.findByText(/waiting for an organiser/)).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
