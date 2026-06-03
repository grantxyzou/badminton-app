// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import PlayersTab from '../../components/PlayersTab';
import enMessages from '../../messages/en.json';

/**
 * Audit silent-failure cluster: a failed players/session fetch must render an
 * explicit "couldn't load" affordance, NOT the same "no one signed up yet"
 * empty state — which lies that the session is empty when the load actually
 * broke (CLAUDE.md: "Lying empty state is forbidden").
 */
function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PlayersTab />
    </NextIntlClientProvider>,
  );
}

describe('PlayersTab — load failure shows an error, not a lying empty state', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders an error pill (not the empty state) when the players fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    renderTab();
    await waitFor(() => {
      expect(screen.getByText(/couldn.t load/i)).toBeTruthy();
    });
    // The lying empty state must NOT be shown.
    expect(screen.queryByText(enMessages.players.empty)).toBeNull();
  });
});
