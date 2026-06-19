// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import CoverSheet from '@/components/admin/CoverSheet';

afterEach(cleanup);

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('<CoverSheet />', () => {
  it('renders the cover-only confirm when open', () => {
    wrap(
      <CoverSheet
        open
        mode="cover-only"
        playerName="Bruce"
        amount={8}
        sessionLabel="Tue, May 14"
        playerId="bruce-1"
        sessionId="session-2026-05-14"
        onClose={() => {}}
        onCovered={() => {}}
      />,
    );
    expect(screen.getByText(/Cover Bruce's \$8/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /I'll cover it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Split it across everyone else/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
  });

  it('"I\'ll cover it" calls PATCH /api/players with writtenOff:true + coverMode:absorb', async () => {
    const onCovered = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'bruce-1', writtenOff: true }), { status: 200 }),
    );

    wrap(
      <CoverSheet
        open
        mode="cover-only"
        playerName="Bruce"
        amount={8}
        sessionLabel="Tue, May 14"
        playerId="bruce-1"
        sessionId="session-2026-05-14"
        onClose={() => {}}
        onCovered={onCovered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /I'll cover it/i }));

    await waitFor(() => expect(onCovered).toHaveBeenCalledOnce());

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/players$/);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      id: 'bruce-1',
      sessionId: 'session-2026-05-14',
      writtenOff: true,
      coverMode: 'absorb',
    });

    fetchSpy.mockRestore();
  });

  it('"Split it across everyone else" sends coverMode:resplit', async () => {
    const onCovered = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'bruce-1', writtenOff: true }), { status: 200 }),
    );

    wrap(
      <CoverSheet
        open
        mode="cover-only"
        playerName="Bruce"
        amount={8}
        sessionLabel="Tue, May 14"
        playerId="bruce-1"
        sessionId="session-2026-05-14"
        onClose={() => {}}
        onCovered={onCovered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Split it across everyone else/i }));
    await waitFor(() => expect(onCovered).toHaveBeenCalledOnce());

    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body).toMatchObject({ id: 'bruce-1', writtenOff: true, coverMode: 'resplit' });

    fetchSpy.mockRestore();
  });

  it('shows error and keeps sheet open when PATCH fails', async () => {
    const onCovered = vi.fn();
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );

    wrap(
      <CoverSheet
        open
        mode="cover-only"
        playerName="Bruce"
        amount={8}
        sessionLabel="Tue, May 14"
        playerId="bruce-1"
        sessionId="session-2026-05-14"
        onClose={onClose}
        onCovered={onCovered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /I'll cover it/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(onCovered).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('"Cover & remove" sends one atomic PATCH with writtenOff + removed', async () => {
    const onCovered = vi.fn();
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'anna-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    try {
      wrap(
        <CoverSheet
          open
          mode="cover-and-remove"
          playerName="Anna"
          amount={16}
          playerId="anna-1"
          sessionId="session-2026-05-14"
          onClose={onClose}
          onCovered={onCovered}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Cover & remove/i }));
      await waitFor(() => expect(onCovered).toHaveBeenCalledOnce());

      // One call, not two — covered-and-removed must not be a non-atomic pair
      // that can leave the player half-updated on a mid-sequence failure.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
      expect(body.writtenOff).toBe(true);
      expect(body.removed).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('"Remove without covering" only PATCHes removed', async () => {
    const onCovered = vi.fn();
    const onClose = vi.fn();
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'anna-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    try {
      wrap(
        <CoverSheet
          open
          mode="cover-and-remove"
          playerName="Anna"
          amount={16}
          playerId="anna-1"
          sessionId="session-2026-05-14"
          onClose={onClose}
          onCovered={onCovered}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Remove without covering/i }));
      await waitFor(() => expect(onCovered).toHaveBeenCalledOnce());

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
      expect(body.removed).toBe(true);
      expect(body.writtenOff).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
