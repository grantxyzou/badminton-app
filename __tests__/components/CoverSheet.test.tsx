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
    expect(screen.getByRole('button', { name: /I got it/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
  });

  it('"I got it" calls PATCH /api/players with writtenOff:true', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /I got it/i }));

    await waitFor(() => expect(onCovered).toHaveBeenCalledOnce());

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/players$/);
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      id: 'bruce-1',
      sessionId: 'session-2026-05-14',
      writtenOff: true,
    });

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

    fireEvent.click(screen.getByRole('button', { name: /I got it/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    expect(onCovered).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
