// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import PlayersTab from '../../components/PlayersTab';
import enMessages from '../../messages/en.json';
import { setIdentity, getIdentity, clearIdentity } from '../../lib/identity';

/**
 * Regression test for the cancel-doesn't-clear-identity invariant
 * (commit 6046755). The bug: PlayersTab.handleCancel used to call
 * `clearIdentity()` after a successful DELETE, conflating "cancel
 * spot" with "sign out". Per the auth taxonomy in CLAUDE.md these
 * are distinct operations — `clearIdentity()` belongs only in
 * ProfileTab.handleLogout.
 *
 * If anyone reintroduces clearIdentity() in the cancel path, this
 * test fails and tells them why.
 */
describe('PlayersTab — cancel spot preserves identity', () => {
  const SESSION_ID = 'session-2026-05-08';
  const PLAYER = {
    id: 'p1',
    name: 'Grant',
    sessionId: SESSION_ID,
    timestamp: '2026-05-07T12:00:00-04:00',
    paid: false,
    waitlisted: false,
    removed: false,
  };
  const SESSION = {
    id: SESSION_ID,
    title: 'Friday Session',
    datetime: '2026-05-08T19:00:00-04:00',
    endDatetime: '2026-05-08T22:00:00-04:00',
    courts: 2,
    maxPlayers: 12,
    costPerCourt: 25,
    locationName: 'Test Gym',
    signupOpen: true,
  };

  beforeEach(() => {
    localStorage.clear();
    setIdentity({ name: 'Grant', token: 'consumed-soon', sessionId: SESSION_ID });

    let playersList: typeof PLAYER[] = [PLAYER];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && u.endsWith('/api/players')) {
        return new Response(JSON.stringify(playersList), { status: 200 });
      }
      if (method === 'GET' && u.endsWith('/api/session')) {
        return new Response(JSON.stringify(SESSION), { status: 200 });
      }
      if (method === 'DELETE' && u.endsWith('/api/players')) {
        playersList = [];
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    clearIdentity();
  });

  it('keeps name + sessionId in localStorage after a successful cancel; only clears the consumed deleteToken', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <PlayersTab />
      </NextIntlClientProvider>
    );

    // Wait for the players list to render and Grant's row to appear.
    const cancelBtn = await waitFor(() => {
      const candidates = screen.getAllByRole('button', { name: /^Cancel$/ });
      // The last "Cancel" button is the one inline with Grant's row;
      // nav and other Cancel buttons may exist.
      const btn = candidates[candidates.length - 1];
      if (!btn) throw new Error('Cancel button not yet rendered');
      return btn;
    });

    fireEvent.click(cancelBtn);

    // Confirm dialog should appear with a Yes button.
    const yesBtn = await waitFor(() => screen.getByRole('button', { name: /^Yes$/ }));
    fireEvent.click(yesBtn);

    // Wait for the DELETE to settle: identity.token should be empty,
    // but name + sessionId must persist.
    await waitFor(() => {
      const id = getIdentity();
      if (!id) throw new Error('identity was cleared (regression: cancel must not log out)');
      if (id.token !== '') throw new Error(`token should be empty, got "${id.token}"`);
    });

    const id = getIdentity();
    expect(id).not.toBeNull();
    expect(id?.name).toBe('Grant');
    expect(id?.sessionId).toBe(SESSION_ID);
    expect(id?.token).toBe('');
  });
});
