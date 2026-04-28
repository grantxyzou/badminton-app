// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RecoverySheet from '../../components/RecoverySheet';
import enMessages from '../../messages/en.json';

const renderWith = (open: boolean, onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RecoverySheet open={open} onClose={onClose} sessionId="session-2026-04-27" />
    </NextIntlClientProvider>,
  );

describe('RecoverySheet', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    global.fetch = vi.fn() as any;
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the PIN sign-in form when open', () => {
    renderWith(true);
    expect(screen.getByLabelText('Your name')).toBeDefined();
    expect(screen.getByLabelText('PIN')).toBeDefined();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeDefined();
  });

  it('does not render when closed', () => {
    renderWith(false);
    expect(screen.queryByLabelText('PIN')).toBeNull();
  });

  it('PIN path success writes identity to localStorage', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ deleteToken: 'new-token-abc' }),
    });
    const onClose = vi.fn();
    renderWith(true, onClose);

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Michael' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      const stored = localStorage.getItem('badminton_identity');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!).token).toBe('new-token-abc');
    });
  });

  it('shows lockout banner on 429', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate_limited', retryAfter: 3600 }),
    });
    renderWith(true);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => {
      expect(screen.getByText(/too many tries/i)).toBeDefined();
    });
  });
});
