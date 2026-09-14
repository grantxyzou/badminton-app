// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import InviteCard from '../../components/admin/CommandCenter/InviteCard';
import enMessages from '../../messages/en.json';

/**
 * A failed invite load is a failure with a way out, not a dead end. The card
 * used to say "refresh to retry" with nothing to tap — and `useInviteLink`
 * already exposed `reload`, so the control only had to be wired. "Try again"
 * must actually ask the server again, not just hide the message.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('InviteCard load failure', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[FLAG] = 'true';
    fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValue(jsonResponse({ token: 'tok', code: 'ABCDEFGH', createdAt: '2026-09-13' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    delete process.env[FLAG];
    vi.unstubAllGlobals();
  });

  it('shows the error with Try again, and Try again re-fetches the invite', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <InviteCard />
      </NextIntlClientProvider>,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn't load the invite/);
    // Not a confident empty card: no code on screen while the load has failed.
    expect(screen.queryByText(/ABCD/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText(/ABCD/)).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/groups/invite');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
