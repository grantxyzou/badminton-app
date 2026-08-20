// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SteppedGameLoggerSheet from '../../components/stats/SteppedGameLoggerSheet';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

function jsonResponse(body: unknown, ok = true, status?: number) {
  return Promise.resolve({ ok, status: status ?? (ok ? 200 : 500), json: async () => body } as Response);
}

const posted: { url: string; body: unknown }[] = [];

function mockFetch(overrides: Record<string, () => Promise<Response>> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posted.push({ url, body: JSON.parse(String(init.body)) });
      }
      for (const [needle, handler] of Object.entries(overrides)) {
        if (url.includes(needle)) return handler();
      }
      if (url.includes('/api/players')) {
        return jsonResponse({
          players: [
            { name: 'Lin' },
            { name: 'Viktor' },
            { name: 'Akane' },
            { name: 'Kento' },
            { name: 'Waity', waitlisted: true },
            { name: 'Gone', removed: true },
          ],
        });
      }
      if (url.includes('/api/games')) return jsonResponse({ id: 'g-new' }, true, 201);
      if (url.includes('/api/kudos')) return jsonResponse({ ok: true }, true, 201);
      return jsonResponse({});
    }) as unknown as typeof fetch,
  );
}

function renderSheet(onLogged = vi.fn(), onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <SteppedGameLoggerSheet
          you="Lin"
          sessionId="session-2026-08-20"
          open
          onClose={onClose}
          onLogged={onLogged}
        />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
  return { onLogged, onClose };
}

describe('SteppedGameLoggerSheet', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    posted.length = 0;
  });

  it('offers tonight\'s roster, excluding the viewer, waitlisted and removed', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Lin/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Waity/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Gone/ })).toBeNull();
  });

  it('advances immediately on picking a partner — no Next on that step', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByText('Who did you play with?')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    expect(screen.getByText(/who were you against\?/)).toBeTruthy();
  });

  it('filters the partner out of the opponent list', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    expect(screen.queryByRole('button', { name: /Viktor/ })).toBeNull();
  });

  it('blocks Next until an opponent is chosen', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('caps opponents at two, replacing the oldest rather than refusing', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    fireEvent.click(screen.getByRole('button', { name: /Kento/ }));
    // A third pick must land, not be silently swallowed.
    expect(screen.getByRole('button', { name: /Kento/ }).getAttribute('aria-pressed')).toBe('true');
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(2);
  });

  it('posts the unchanged body shape and reports the win', async () => {
    mockFetch();
    const { onLogged } = renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('You won')).toBeTruthy(); // 21-15 default
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    const post = posted.find((p) => p.url.includes('/api/games'));
    expect(post?.body).toEqual({
      sessionId: 'session-2026-08-20',
      teamA: ['Lin', 'Viktor'],
      teamB: ['Akane'],
      scoreA: 21,
      scoreB: 15,
      loggedBy: 'Lin',
    });
  });

  it('steps the score and re-reads who won', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    // Drive the viewer's score below the opponent's.
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Your score −1' }));
    }
    expect(screen.getByText('They won')).toBeTruthy();
  });

  it('offers kudos to the partner after logging', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    await waitFor(() => expect(screen.getByText('Logged — thanks!')).toBeTruthy());
    expect(screen.getByText('Send Viktor some kudos?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Clutch/ }));
    await waitFor(() => {
      const post = posted.find((p) => p.url.includes('/api/kudos'));
      expect(post?.body).toEqual({ recipientName: 'Viktor', tag: 'clutch' });
    });
  });

  it('surfaces a save failure instead of pretending it logged', async () => {
    mockFetch({ '/api/games': () => jsonResponse({ error: 'save_failed' }, false) });
    const { onLogged } = renderSheet();
    await waitFor(() => expect(screen.getByRole('button', { name: /Viktor/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Viktor/ }));
    fireEvent.click(screen.getByRole('button', { name: /Akane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onLogged).not.toHaveBeenCalled();
    expect(screen.queryByText('Logged — thanks!')).toBeNull();
  });

  it('still lets a guest be added when the roster read fails', async () => {
    mockFetch({ '/api/players': () => jsonResponse({ error: 'load_failed' }, false) });
    renderSheet();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // Legible failure that does not block the task.
    fireEvent.click(screen.getByRole('button', { name: 'Add someone not on the list' }));
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Ravi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/who were you against\?/)).toBeTruthy();
  });
});
