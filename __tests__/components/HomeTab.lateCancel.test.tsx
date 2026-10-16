// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * The late-cancellation step in the cancel sheet (docs/plans/late-cancel-fee.md).
 *
 * The server is the authority: the first "Cancel my spot" is answered 409
 * `late_cancel` when the club's window applies, the same sheet turns into the
 * amber fee warning, and "Cancel anyway" resends with `acknowledgeLateFee`.
 * Closing the sheet forgets the warning, and a 409 that is anything else is
 * still a failure.
 */

const session = {
  id: 'session-2026-10-16',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  deadline: new Date(Date.now() + 10 * 3_600_000).toISOString(),
  locationName: 'Test Gym',
};

type Row = { id: string; name: string; waitlisted: boolean };
let roster: Row[];
let fetchMock: ReturnType<typeof vi.fn>;
let deleteAnswer: (body: Record<string, unknown>) => Response;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

const deleteBodies = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);

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
  ];
  // The club's window applies: refuse until acknowledged, then cancel.
  deleteAnswer = (body) => {
    if (body.acknowledgeLateFee !== true) return ok({ error: 'late_cancel', hours: 48 }, 409);
    roster = roster.filter((r) => r.name !== 'Grant');
    return ok({ success: true });
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/kudos/eligible')) return ok({ eligible: [] });
    if (url.includes('/api/players') && init?.method === 'DELETE') return deleteAnswer(JSON.parse(String(init.body)));
    if (url.includes('/api/players')) return ok(roster);
    return ok([]);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openCancelSheet() {
  renderHome();
  fireEvent.click(await screen.findByRole('button', { name: enMessages.home.signup.cantMakeIt }));
  expect(await screen.findByText(enMessages.players.cancelSheetBody)).toBeDefined();
}

describe('cancel sheet — late cancellation', () => {
  it('turns into the fee warning when the server says the cancel is late, and keeps the spot', async () => {
    await openCancelSheet();
    fireEvent.click(screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }));

    expect(await screen.findByText('The session starts in less than 48 hours')).toBeDefined();
    expect(screen.getByText(enMessages.players.lateCancelBody)).toBeDefined();
    // A step, not a failure: no error line, and nothing was cancelled.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(deleteBodies()).toEqual([{ name: 'Grant', deleteToken: 'tok' }]);
    expect(screen.getByText('Grant, you have signed up for this week!')).toBeDefined();
  });

  it('"Cancel anyway" resends with the acknowledgement and the spot is released', async () => {
    await openCancelSheet();
    fireEvent.click(screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }));
    fireEvent.click(await screen.findByRole('button', { name: enMessages.players.lateCancelConfirm }));

    await waitFor(() => expect(deleteBodies()).toHaveLength(2));
    expect(deleteBodies()[1]).toEqual({ name: 'Grant', deleteToken: 'tok', acknowledgeLateFee: true });
    expect(await screen.findByText('Signing up as Grant')).toBeDefined();
  });

  it('closing the sheet forgets the warning: reopened, it asks the plain question again', async () => {
    await openCancelSheet();
    fireEvent.click(screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }));
    await screen.findByText('The session starts in less than 48 hours');
    fireEvent.click(screen.getByRole('button', { name: enMessages.players.sheetKeep }));

    fireEvent.click(await screen.findByRole('button', { name: enMessages.home.signup.cantMakeIt }));
    expect(await screen.findByText(enMessages.players.cancelSheetBody)).toBeDefined();
    expect(screen.queryByText('The session starts in less than 48 hours')).toBeNull();
  });

  it('a 409 that is not the late-fee answer is still a failure', async () => {
    deleteAnswer = () => ok({ error: 'something_else' }, 409);
    await openCancelSheet();
    fireEvent.click(screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }));

    expect(await screen.findByText(enMessages.players.cancelFailure)).toBeDefined();
    expect(screen.queryByText('The session starts in less than 48 hours')).toBeNull();
  });
});
