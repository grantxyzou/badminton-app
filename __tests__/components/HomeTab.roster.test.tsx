// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * Home's sign-up card IS the sign-up list (2026-09-16).
 *
 * The Sign-Ups tab left the nav for Stringing. Everything it did has to be
 * reachable from the card, or it is gone: who is in (numbered, with the
 * waitlist), cancelling your own spot or leaving the waitlist, and kudos per
 * name. These tests are the ones that used to guard PlayersTab, moved.
 */

const session = {
  id: 'session-2026-09-17',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  locationName: 'Test Gym',
};

type Row = { id: string; name: string; waitlisted: boolean };
let roster: Row[];
let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab memberName="Grant" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Grant', token: 'tok', sessionId: session.id }));
  roster = [
    { id: 'p1', name: 'Lin', waitlisted: false },
    { id: 'p2', name: 'Grant', waitlisted: false },
    { id: 'p3', name: 'Viktor', waitlisted: false },
  ];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/kudos/eligible')) return ok({ eligible: [] });
    if (url.includes('/api/players') && init?.method === 'DELETE') {
      roster = roster.filter((r) => r.name !== 'Grant');
      return ok({ ok: true });
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

async function openRoster() {
  fireEvent.click(await screen.findByRole('button', { name: /are in$|is in$/ }));
  return screen.getAllByRole('list');
}

describe('the sign-up card as the sign-up list', () => {
  it('no longer sends people to a Sign-Ups tab', async () => {
    renderHome();
    await screen.findByText("Grant, you're in");
    expect(screen.queryByRole('button', { name: /View Sign Up List/i })).toBeNull();
  });

  it('opens the roster numbered in sign-up order, the viewer included', async () => {
    renderHome();
    await screen.findByText("Grant, you're in");
    const [active] = await openRoster();
    const items = within(active).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toMatch(/^1.*Lin/);
    expect(items[1]).toMatch(/^2.*Grant/);
    expect(items[2]).toMatch(/^3.*Viktor/);
  });

  it('shows the waitlist as a second section, numbering on from the active list', async () => {
    roster.push({ id: 'p4', name: 'Akane', waitlisted: true });
    renderHome();
    await screen.findByText("Grant, you're in");
    const lists = await openRoster();
    expect(screen.getByText(enMessages.players.waitlistHeader)).toBeDefined();
    expect(within(lists[1]).getByRole('listitem').textContent).toMatch(/^4.*Akane/);
  });

  it('offers kudos on every row but your own, and opens the sheet on that person', async () => {
    renderHome();
    await screen.findByText("Grant, you're in");
    await openRoster();
    expect(screen.getByRole('button', { name: 'Give kudos to Lin' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Give kudos to Grant' })).toBeNull();
  });

  it('cancels your spot from the card through a sheet that names the action', async () => {
    renderHome();
    await screen.findByText("Grant, you're in");
    fireEvent.click(screen.getByRole('button', { name: enMessages.home.signup.cantMakeIt }));
    expect(await screen.findByText(enMessages.players.cancelSheetBody)).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Yes$/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(true),
    );
    // Back to the sign-up form, still identified: cancelling is not signing out.
    expect(await screen.findByText('Signing up as Grant')).toBeDefined();
    const id = JSON.parse(localStorage.getItem('badminton_identity') ?? '{}');
    expect(id.name).toBe('Grant');
    expect(id.token).toBe('');
  });

  it('dismissing the sheet cancels nothing', async () => {
    renderHome();
    await screen.findByText("Grant, you're in");
    fireEvent.click(screen.getByRole('button', { name: enMessages.home.signup.cantMakeIt }));
    fireEvent.click(await screen.findByRole('button', { name: enMessages.players.sheetKeep }));
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  it('words it as leaving the waitlist when that is where you are', async () => {
    roster = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `Player ${i}`, waitlisted: false })),
      { id: 'w1', name: 'Grant', waitlisted: true },
    ];
    renderHome();
    fireEvent.click(await screen.findByRole('button', { name: enMessages.home.signup.leaveWaitlist }));
    expect(await screen.findByText(enMessages.players.leaveSheetBody)).toBeDefined();
    expect(screen.queryByText(enMessages.players.cancelSheetBody)).toBeNull();
  });
});
