// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import PlayersTab from '../../components/PlayersTab';
import enMessages from '../../messages/en.json';

/**
 * The cancel confirmation is a BottomSheet, not an inline row expansion.
 *
 * It used to render inside the player's own row, so the question and its two
 * buttons got whatever width was left after the name — "Cancel your spot?"
 * wrapped onto three lines beside a long one. A row is not a container for a
 * decision.
 */

const originalFetch = global.fetch;

function mockRoster(opts: { waitlisted?: boolean } = {}) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/players')) {
      return new Response(
        JSON.stringify([
          { id: 'p1', name: 'Lin', waitlisted: false },
          { id: 'p2', name: 'Grant', waitlisted: !!opts.waitlisted },
        ]),
        { status: 200 },
      );
    }
    if (url.includes('/api/session')) {
      return new Response(JSON.stringify({ datetime: '2026-08-29T17:00:00-07:00', maxPlayers: 12 }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

const renderTab = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PlayersTab />
    </NextIntlClientProvider>,
  );

async function openSheet(actionLabel: RegExp) {
  const btn = await waitFor(() => {
    const all = screen.getAllByRole('button', { name: actionLabel });
    const last = all[all.length - 1];
    if (!last) throw new Error('row action not rendered');
    return last;
  });
  fireEvent.click(btn);
}

describe('PlayersTab — cancel confirmation sheet', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Grant', token: 'tok', sessionId: 'session-2026-08-29' }),
    );
    mockRoster();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('shows nothing until the row action is tapped', async () => {
    renderTab();
    await waitFor(() => expect(screen.getAllByText('Grant').length).toBeGreaterThan(0));
    expect(screen.queryByText(enMessages.players.cancelSheetBody)).toBeNull();
  });

  it('opens a sheet naming the destructive action, not "Yes"', async () => {
    renderTab();
    await openSheet(/^Cancel$/);
    expect(await screen.findByText(enMessages.players.cancelSheetBody)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: enMessages.players.cancelSheetConfirm }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: enMessages.players.sheetKeep })).toBeTruthy();
    // The old inline affordance is gone.
    expect(screen.queryByRole('button', { name: /^Yes$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^No$/ })).toBeNull();
  });

  it('dismisses without cancelling the spot', async () => {
    renderTab();
    await openSheet(/^Cancel$/);
    const keep = await screen.findByRole('button', { name: enMessages.players.sheetKeep });
    fireEvent.click(keep);
    await waitFor(() => {
      expect(screen.queryByText(enMessages.players.cancelSheetBody)).toBeNull();
    });
    // No DELETE was fired.
    const calls = (global.fetch as unknown as { mock?: { calls: unknown[][] } }).mock?.calls ?? [];
    expect(calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });

  /**
   * Coming off a waitlist is not the same event as giving up a confirmed spot,
   * and one sheet serving both rows has to say which it means.
   */
  it('words itself for the waitlist when that is the list you are in', async () => {
    mockRoster({ waitlisted: true });
    renderTab();
    await openSheet(/^Leave$/);
    expect(await screen.findByText(enMessages.players.leaveSheetBody)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: enMessages.players.leaveSheetConfirm }),
    ).toBeTruthy();
    expect(screen.queryByText(enMessages.players.cancelSheetBody)).toBeNull();
  });
});
