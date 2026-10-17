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

  it('with no verified name, names the local identity — still no field to type into', async () => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Kento', sessionId: session.id }));
    renderHome(null);
    expect(await screen.findByText('Signing up as Kento')).toBeDefined();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('with no name at all, offers no sign-up form rather than an anonymous one', async () => {
    renderHome(null);
    await screen.findByText(/spots? left/i);
    expect(screen.queryByText(/Signing up as/)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Sign up for this week/i })).toBeNull();
  });

  it('signs up with one tap', async () => {
    renderHome('Lin');
    await screen.findByText('Signing up as Lin');
    // Role queries skip the RevealSlot's `hidden` wrapper; the text query above
    // does not, so await the button too (same race as #540).
    fireEvent.click(await screen.findByRole('button', { name: /Sign up for this week/i }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes('/api/players') && (i as RequestInit)?.method === 'POST')).toBe(true),
    );
  });

});

/**
 * 2026-09-13 flow audit, finding 1: an admin-approved access request signs a
 * member in with a 30-day session and NO credential. Home must say so and hand
 * them a PIN, or they are locked out again when the session lapses.
 */
describe('signed in with nothing to sign in with next time', () => {
  function methods(m: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/methods')) return ok(m);
      if (url.includes('/api/session')) return ok(session);
      if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
      if (url.includes('/api/stringing/shop')) return ok({ open: false });
      return ok([]);
    });
  }

  afterEach(() => sessionStorage.clear());

  it('shows "Set a PIN" when the account has no PIN, password or provider', async () => {
    methods({ hasPin: false, hasPassword: false, linked: [] });
    renderHome('Kento');
    expect(await screen.findByText('Set a PIN so you can get back in')).toBeDefined();
    // The banner sits in a RevealSlot whose wrapper is `hidden` until its
    // stagger turn (components/primitives/Reveal.tsx). `findByText` ignores
    // `hidden`; role queries skip hidden elements, so the button must be
    // awaited too, or a methods probe landing after the 100 ms grace fails
    // this line on a slow runner (#540).
    expect(await screen.findByRole('button', { name: 'Set a PIN' })).toBeDefined();
  });

  it.each([
    ['a PIN', { hasPin: true, hasPassword: false, linked: [] }],
    ['a password', { hasPin: false, hasPassword: true, linked: [] }],
    ['Google', { hasPin: false, hasPassword: false, linked: ['google'] }],
  ])('shows nothing for a member with %s', async (_label, m) => {
    methods(m);
    renderHome('Lin');
    await screen.findByText('Signing up as Lin');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Set a PIN so you can get back in')).toBeNull();
  });

  it('opens the PIN sheet by itself right after an approval, and uses the marker once', async () => {
    sessionStorage.setItem('badminton_offer_pin', '1');
    methods({ hasPin: false, hasPassword: false, linked: [] });
    renderHome('Kento');
    await screen.findByText('Set a PIN so you can get back in');
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    expect(sessionStorage.getItem('badminton_offer_pin')).toBeNull();
  });

  it('does not open the sheet without the marker', async () => {
    methods({ hasPin: false, hasPassword: false, linked: [] });
    renderHome('Kento');
    await screen.findByText('Set a PIN so you can get back in');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
