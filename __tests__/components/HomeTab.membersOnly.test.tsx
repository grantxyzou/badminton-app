// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * MEMBERS ONLY, PART 3 (docs/plans/members-only.md): with the server having
 * verified who this is, Home's sign-up card signs up THAT person.
 *
 * The server takes the name from the account and ignores anything typed, so a
 * name field here would be a control that does nothing — and the adaptive
 * probe behind it would publish the name to `members/me` for no reason. One
 * line saying who, one button.
 */

const session = {
  id: 'session-2026-09-17',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  locationName: 'Test Gym',
};

let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function renderHome(memberName: string | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab memberName={memberName} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players') && init?.method === 'POST') {
      return ok({ name: 'Lin', deleteToken: 't'.repeat(32), sessionId: session.id }, 201);
    }
    // The account cards render as soon as there is a current user — which, with
    // a verified member, is the first render — so they need their real shapes.
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/stringing/shop')) return ok({ open: false });
    if (url.includes('/api/players')) return ok([]);
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Home sign-up card, members only', () => {
  it('says who is signing up, with no name field to type into', async () => {
    renderHome('Lin');
    expect(await screen.findByText('Signing up as Lin')).toBeDefined();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('never probes members/me — there is nothing to find out about a name that is locked', async () => {
    renderHome('Lin');
    await screen.findByText('Signing up as Lin');
    await new Promise((r) => setTimeout(r, 700)); // past the probe's 500ms debounce
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/members/me'))).toBe(false);
  });

  it('signs up with one tap', async () => {
    renderHome('Lin');
    await screen.findByText('Signing up as Lin');
    fireEvent.click(screen.getByRole('button', { name: /I'm in/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/api/players') && (i as RequestInit)?.method === 'POST')).toBe(true),
    );
  });

  it('flag off (no memberName): the name field is still there, exactly as before', async () => {
    renderHome(null);
    await waitFor(() => expect(screen.queryByText(/Signing up as/)).toBeNull());
    expect(await screen.findByLabelText('Your name')).toBeDefined();
  });
});
