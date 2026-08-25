// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CheckInSheet from '../../components/stats/CheckInSheet';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

/**
 * The reconciliation mirror must not turn a failed read into "no games".
 *
 * `mirror` was a single nullable value, so a 500 on /api/games collapsed into
 * the same falsy state as a genuine zero and rendered `assess.noGames`. This
 * is the screen whose stated job is reconciling self-rating against actual
 * results, so the lie doesn't just mislead — it biases the ratings the member
 * then enters. CLAUDE.md names this pattern as the v1.3 Cosmos-misconfig
 * disaster.
 */
function mockGames(mode: 'ok' | 'fail' | 'empty') {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/games')) {
        if (mode === 'fail') {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'load_failed' }) } as Response);
        }
        const games = mode === 'empty' ? [] : [
          { teamA: ['Lin', 'Viktor'], teamB: ['Akane', 'Kento'], scoreA: 21, scoreB: 15 },
          { teamA: ['Akane', 'Kento'], teamB: ['Lin', 'Viktor'], scoreA: 21, scoreB: 18 },
        ];
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ games }) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
    }) as unknown as typeof fetch,
  );
}

function renderSheet() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <CheckInSheet name="Lin" open onClose={vi.fn()} onSaved={vi.fn()} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

describe('CheckInSheet — the mirror distinguishes failed from empty', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an error, NOT "no games", when the games read fails', async () => {
    mockGames('fail');
    renderSheet();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(enMessages.stats.assess.noGames)).toBeNull();
  });

  it('still shows the empty copy for a genuine zero', async () => {
    mockGames('empty');
    renderSheet();

    await waitFor(() => expect(screen.getByText(enMessages.stats.assess.noGames)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the record when games exist', async () => {
    mockGames('ok');
    renderSheet();

    await waitFor(() => expect(screen.getByText(/won 1 of 2 recent games/i)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(enMessages.stats.assess.noGames)).toBeNull();
  });
});
