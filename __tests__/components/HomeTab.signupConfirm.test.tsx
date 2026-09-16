// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * The moment of signing up.
 *
 * Three things this pins: the confirmation carries the plan (when and where),
 * the card says who else is in, and signing up does NOT blank Home into the
 * loading skeleton — it used to, which rebuilt the whole tab before the
 * confirmation could appear.
 */

const session = {
  id: 'session-2026-09-17',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  locationName: 'Test Gym',
};

let roster: Array<{ id: string; name: string; waitlisted: boolean }>;
let fetchMock: ReturnType<typeof vi.fn>;
/** Set once the POST lands: every later read hangs, so a card that waits for
 *  the refetch (or shows a skeleton until it lands) never confirms. */
let holdReads = false;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab memberName="Lin" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  holdReads = false;
  roster = [
    { id: 'p1', name: 'Viktor', waitlisted: false },
    { id: 'p2', name: 'Akane', waitlisted: false },
    { id: 'p3', name: 'Kento', waitlisted: false },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (holdReads && init?.method !== 'POST') return new Promise<Response>(() => {});
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/stringing/shop')) return ok({ open: false });
    if (url.includes('/api/players') && init?.method === 'POST') {
      const row = { id: 'p4', name: 'Lin', waitlisted: false, sessionId: session.id };
      roster = [...roster, row];
      holdReads = true;
      return ok({ ...row, deleteToken: 't'.repeat(32) }, 201);
    }
    if (url.includes('/api/players')) return ok(roster);
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('signing up', () => {
  it('says who else is in before you tap, newest first', async () => {
    renderHome();
    expect(await screen.findByText('Kento, Akane and 1 other are in')).toBeDefined();
  });

  it('confirms with the plan itself, without dropping Home into the skeleton', async () => {
    renderHome();
    await screen.findByText('Signing up as Lin');
    fireEvent.click(screen.getByRole('button', { name: /I'm in/i }));

    expect(await screen.findByText("Lin, you're in")).toBeDefined();
    expect(screen.getByText(/ at Test Gym$/)).toBeDefined();
    // Lin is not in their own "who else" line.
    expect(screen.getByText('Kento, Akane and 1 other are in')).toBeDefined();
    // All of that landed while the background refresh is still in flight
    // (reads hang after the POST), and Home never dropped into the skeleton.
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/api/players') && !(i as RequestInit)?.method).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('never carries the delete token into the roster it renders', async () => {
    renderHome();
    await screen.findByText('Signing up as Lin');
    fireEvent.click(screen.getByRole('button', { name: /I'm in/i }));
    await screen.findByText("Lin, you're in");
    expect(document.body.innerHTML).not.toContain('t'.repeat(32));
  });
});
