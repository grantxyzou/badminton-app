// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SessionListCard from '../../components/admin/CommandCenter/SessionListCard';
import { resetSharedReads } from '../../lib/sharedRead';
import { applyStyle, type ClubRun } from '../../lib/clubRun';
import enMessages from '../../messages/en.json';

/**
 * The money-off club's list (docs/plans/money-off-session-list.md). With money
 * off the Command Center drops PaymentsCard, which was the only admin list of
 * who signed up; this card is that list with every money surface left out.
 */

const DAY = 86_400_000;
const future = new Date(Date.now() + 6 * DAY).toISOString();
const SESSION = { id: 'club-x:session-2026-11-14', datetime: future, maxPlayers: 3 };

type Row = Record<string, unknown> & { id: string; name: string };
const row = (id: string, name: string, minute: number, extra: Record<string, unknown> = {}): Row => ({
  id,
  name,
  sessionId: SESSION.id,
  timestamp: `2026-11-08T10:${String(minute).padStart(2, '0')}:00.000Z`,
  ...extra,
});

let session: Record<string, unknown> | null;
let players: Row[];
let fetchMock: ReturnType<typeof vi.fn>;
let writeResponse: () => Response;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resetSharedReads();
  session = { ...SESSION };
  players = [];
  writeResponse = () => json({ success: true });
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  vi.stubGlobal('confirm', () => true);
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') return writeResponse();
    if (url.includes('/api/players')) return json(players);
    if (url.includes('/api/session')) {
      return session ? json(session) : json({ error: 'no_active_session' }, 404);
    }
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSharedReads();
});

/** The list sits behind one line ("N of M in · K waiting"); open it. */
async function openList() {
  fireEvent.click(await screen.findByRole('button', { name: 'Show the list' }));
}

function renderCard(props: { onChanged?: () => void; run?: ClubRun } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SessionListCard {...props} />
    </NextIntlClientProvider>,
  );
}

const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init && (init as RequestInit).method && (init as RequestInit).method !== 'GET')
    .map(([, init]) => ({ method: (init as RequestInit).method, body: JSON.parse(String((init as RequestInit).body)) }));

describe('the list', () => {
  it('reads the removed rows too, in one admin read', async () => {
    renderCard();
    await screen.findByText("This week's list");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/api/players?all=true'))).toBe(true);
  });

  it('numbers the confirmed list in sign-up order and the waitlist on from it, with no money anywhere', async () => {
    players = [
      row('p3', 'Carolina', 3),
      row('p1', 'Lin', 1),
      row('p2', 'Viktor', 2),
      row('w2', 'Kento', 5, { waitlisted: true }),
      row('w1', 'Akane', 4, { waitlisted: true }),
    ];
    renderCard();
    expect(await screen.findByText('3 of 3 in · 2 waiting')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'In' })).toBeNull();
    await openList();
    const inList = await screen.findByRole('list', { name: 'In' });
    expect(within(inList).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^1.*Lin/),
      expect.stringMatching(/^2.*Viktor/),
      expect.stringMatching(/^3.*Carolina/),
    ]);
    const waitlist = screen.getByRole('list', { name: 'Waitlist' });
    expect(within(waitlist).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^4.*Akane/),
      expect.stringMatching(/^5.*Kento/),
    ]);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\$|paid|receipt|cover|owe/i);
  });

  it('marks a row waiting for members only while the window runs', async () => {
    session = { ...SESSION, membersFirst: { daysBefore: 1, time: '00:00' } };
    players = [row('p1', 'Lin', 1), row('w1', 'Dee', 2, { waitlisted: true, waitingForMembers: true })];
    renderCard();
    await openList();
    expect(await screen.findByText('Members first')).toBeTruthy();
    cleanup();
    resetSharedReads();
    session = { ...SESSION, membersFirst: { daysBefore: 1, time: '00:00' }, membersFirstReleasedAt: new Date().toISOString() };
    renderCard();
    await openList();
    await screen.findByText(/Dee/);
    expect(screen.queryByText('Members first')).toBeNull();
  });

  it('says nobody has signed up on an empty list, and still offers Add', async () => {
    renderCard();
    expect(await screen.findByText('Nobody has signed up yet.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Add player by name' })).toBeTruthy();
  });

  it('a failed read is an error with a retry, never an empty list', async () => {
    fetchMock.mockImplementation(async () => json({ error: 'read_failed' }, 503));
    renderCard();
    expect(await screen.findByText(/Couldn.t load the list/)).toBeTruthy();
    expect(screen.queryByText('Nobody has signed up yet.')).toBeNull();
  });

  it('renders nothing for a club with no session yet; the session card says so', async () => {
    session = null;
    const { container } = renderCard();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('cancelled and late', () => {
  it('counts the late cancels on the folded line, and Restore brings one back', async () => {
    const onChanged = vi.fn();
    players = [
      row('p1', 'Lin', 1),
      row('x1', 'Sindhu', 2, { removed: true, removedAt: '2026-11-12T14:00:00.000Z', cancelledBySelf: true, lateCancel: true, lateCancelHoursBefore: 30 }),
      row('x2', 'Kento', 3, { removed: true, removedAt: '2026-11-10T09:00:00.000Z', cancelledBySelf: true }),
    ];
    renderCard({ onChanged });
    expect(await screen.findByText(/2 cancelled · 1 late/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show cancelled' }));
    expect(screen.getByText('Late · 30h')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(writes()).toEqual([{ method: 'PATCH', body: { id: 'x1', removed: false } }]);
  });
});

describe('the row sheet', () => {
  it('moves a confirmed player to the waitlist, and says nobody moves up', async () => {
    const onChanged = vi.fn();
    players = [row('p1', 'Lin', 1), row('p2', 'Viktor', 2)];
    renderCard({ onChanged });
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Viktor' }));
    expect(screen.getByText(/Nobody moves up into their spot/)).toBeTruthy();
    expect(screen.queryByText('Move into the session')).toBeNull();
    fireEvent.click(screen.getByText('Move to the waitlist'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(writes()).toEqual([{ method: 'PATCH', body: { id: 'p2', waitlisted: true } }]);
  });

  it('moves a waitlisted player in when there is room', async () => {
    players = [row('p1', 'Lin', 1), row('w1', 'Akane', 2, { waitlisted: true })];
    renderCard();
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Akane' }));
    fireEvent.click(screen.getByText('Move into the session'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'PATCH', body: { id: 'w1', waitlisted: false } }]));
  });

  it('will not offer to move someone into a full session', async () => {
    players = [row('p1', 'Lin', 1), row('p2', 'Viktor', 2), row('p3', 'Carolina', 3), row('w1', 'Akane', 4, { waitlisted: true })];
    renderCard();
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Akane' }));
    expect(screen.getByText(/The session is full/)).toBeTruthy();
    fireEvent.click(screen.getByText('Move into the session'));
    expect(writes()).toEqual([]);
  });

  it('removes by name, as the admin DELETE finds the row', async () => {
    players = [row('p1', 'Lin', 1), row('p2', 'Viktor', 2)];
    renderCard();
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Lin' }));
    fireEvent.click(screen.getByText('Remove from session'));
    await waitFor(() => expect(writes()).toEqual([{ method: 'DELETE', body: { name: 'Lin' } }]));
  });

  it('keeps the sheet open with the server’s reason when a move is refused', async () => {
    writeResponse = () => json({ error: 'Session is full' }, 409);
    players = [row('p1', 'Lin', 1), row('w1', 'Akane', 2, { waitlisted: true })];
    renderCard();
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Akane' }));
    fireEvent.click(screen.getByText('Move into the session'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Session is full');
    expect(screen.getByText('Move into the session')).toBeTruthy();
  });

  it('offers a guest an invite to the club', async () => {
    players = [row('p1', 'Lin', 1, { memberId: 'm-lin' }), row('g1', "Alex (Lin's guest)", 2, { guestOf: 'm-lin', guestName: 'Alex' })];
    renderCard();
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: /Actions for Alex/ }));
    expect(screen.getByText('Invite to the club')).toBeTruthy();
    expect(screen.getByText('A one-time link for Alex to join')).toBeTruthy();
  });

  it('adds a player by name', async () => {
    const onChanged = vi.fn();
    renderCard({ onChanged });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Add player by name' }), { target: { value: ' Taufik ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // `waitlist: true` always: a spot while there is one, the waitlist once full.
    expect(writes()).toEqual([{ method: 'POST', body: { name: 'Taufik', waitlist: true } }]);
  });
});

describe('the courts are the cap', () => {
  /** Two courts of two: the cap is 4, and the waitlist is what overflows them. */
  const run: ClubRun = { ...applyStyle('members_first'), playersPerCourt: 2, membersFirst: null };
  const fullSession = () => {
    session = { ...SESSION, courts: 2, maxPlayers: 4 };
    players = [
      row('p1', 'Lin', 1), row('p2', 'Viktor', 2), row('p3', 'Carolina', 3), row('p4', 'Akane', 4),
      row('w1', 'Kento', 5, { waitlisted: true }),
      row('x1', 'Sindhu', 6, { removed: true, removedAt: '2026-11-12T14:00:00.000Z', cancelledBySelf: true }),
      row('x2', 'Ratchanok', 7, { removed: true, waitlisted: true, removedAt: '2026-11-11T14:00:00.000Z', cancelledBySelf: true }),
    ];
  };

  it('counts the courts on the line and says how close the waitlist is to another court', async () => {
    fullSession();
    renderCard({ run });
    expect(await screen.findByText('4 of 4 in · 2 courts · 1 waiting')).toBeTruthy();
    await openList();
    expect(screen.getByText('Waitlist · 1 more fills a court')).toBeTruthy();
  });

  it('a full session says so in courts and offers nobody a spot', async () => {
    fullSession();
    renderCard({ run });
    await openList();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Kento' }));
    expect(screen.getByText('All 2 courts are full at 2 a court. Add a court in Edit details, or remove someone first.')).toBeTruthy();
    fireEvent.click(screen.getByText('Move into the session'));
    expect(writes()).toEqual([]);
  });

  it('adding to a full session joins the waitlist', async () => {
    fullSession();
    renderCard({ run });
    const field = await screen.findByRole('textbox', { name: 'Add player by name' });
    expect(field.getAttribute('placeholder')).toBe('Add to the waitlist by name');
    fireEvent.change(field, { target: { value: 'Taufik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(writes()).toEqual([{ method: 'POST', body: { name: 'Taufik', waitlist: true } }]));
  });

  it('restoring into a full session brings them back onto the waitlist', async () => {
    fullSession();
    renderCard({ run });
    fireEvent.click(await screen.findByRole('button', { name: 'Show cancelled' }));
    const buttons = screen.getAllByRole('button', { name: 'To waitlist' });
    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(writes()).toEqual([{ method: 'PATCH', body: { id: 'x1', removed: false, waitlisted: true } }]));
  });

  it('with room, a restore takes a spot and the line says nothing of courts it cannot know', async () => {
    session = { ...SESSION, maxPlayers: 13, courts: 2 };
    players = [row('p1', 'Lin', 1), row('w1', 'Kento', 2, { waitlisted: true })];
    renderCard({ run: applyStyle('first_come') });
    await openList();
    // 13 on 2 courts does not divide: no players-per-court, so no court line.
    expect(screen.getByText('Waitlist')).toBeTruthy();
    expect(screen.getByText('1 of 13 in · 2 courts · 1 waiting')).toBeTruthy();
  });
});
