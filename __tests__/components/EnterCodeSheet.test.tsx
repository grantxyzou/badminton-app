// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import EnterCodeSheet from '@/components/EnterCodeSheet';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Lin' } });
  fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: /Sign in with code/i }));
}

/**
 * Audit-tail fix: the recover endpoint is rate-limited (10/hr), so telling a
 * user their (possibly correct) code is "wrong" on a server outage burns their
 * scarce attempts. A 5xx / network failure must surface as a retryable server
 * error, NOT as errorInvalid.
 */
describe('<EnterCodeSheet /> error mapping', () => {
  it('maps a 5xx to the retryable server error, not "wrong code"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    wrap(<EnterCodeSheet open onClose={() => {}} sessionId="session-2026-06-04" />);
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the server. Try again.")).toBeTruthy();
    });
    expect(screen.queryByText("That didn't match. Try again.")).toBeNull();
  });

  it('maps a network failure (fetch rejects) to the server error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));

    wrap(<EnterCodeSheet open onClose={() => {}} sessionId="session-2026-06-04" />);
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("Couldn't reach the server. Try again.")).toBeTruthy();
    });
  });

  it('still maps a genuine bad code (4xx) to "wrong code"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }));

    wrap(<EnterCodeSheet open onClose={() => {}} sessionId="session-2026-06-04" />);
    fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByText("That didn't match. Try again.")).toBeTruthy();
    });
    expect(screen.queryByText("Couldn't reach the server. Try again.")).toBeNull();
  });
});
