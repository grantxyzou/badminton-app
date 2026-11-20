// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import SignInForm from '@/components/SignInForm';
import AdminSignInCard from '@/components/admin/AdminSignInCard';
import RecoveryPinSheet from '@/components/RecoveryPinSheet';
import { formatPause } from '@/lib/usePinPause';

/**
 * docs/plans/sign-in-redesign.md, step 2: when the server answers
 * `pin_paused`, every PIN field says "Let's pause a moment — try again in 3:42",
 * is disabled while it counts down, and comes back when it runs out.
 */

const paused = (seconds: number) =>
  new Response(JSON.stringify({ error: 'pin_paused', retryAfter: seconds }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(seconds) },
  });

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    {ui}
  </NextIntlClientProvider>
);

const pinFields = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name="pin-4"]'));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('formatPause', () => {
  it('reads as minutes and seconds', () => {
    expect(formatPause(222)).toBe('3:42');
    expect(formatPause(60)).toBe('1:00');
    expect(formatPause(3487)).toBe('58:07');
    expect(formatPause(0.2)).toBe('0:01');
  });
});

describe('SignInForm', () => {
  it('counts down with the PIN field disabled, then lets them try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => paused(222)));
    render(wrap(<SignInForm sessionId="" onSuccess={vi.fn()} probeName={false} />));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin' } });
    fireEvent.change(pinFields()[0], { target: { value: '0000' } });
    await act(async () => {
      fireEvent.submit(pinFields()[0].closest('form')!);
    });

    expect(screen.getByRole('alert').textContent).toBe("Let's pause a moment — try again in 3:42.");
    expect(pinFields()[0].disabled).toBe(true);

    act(() => vi.advanceTimersByTime(42_000));
    expect(screen.getByRole('alert').textContent).toBe("Let's pause a moment — try again in 3:00.");

    act(() => vi.advanceTimersByTime(180_000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pinFields()[0].disabled).toBe(false);
  });

  it('a plain rate limit is still the old message, with no countdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })));
    render(wrap(<SignInForm sessionId="" onSuccess={vi.fn()} probeName={false} />));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin' } });
    fireEvent.change(pinFields()[0], { target: { value: '0000' } });
    await act(async () => {
      fireEvent.submit(pinFields()[0].closest('form')!);
    });
    expect(screen.getByRole('alert').textContent).not.toMatch(/Try again in \d/);
    expect(pinFields()[0].disabled).toBe(false);
  });
});

describe('AdminSignInCard', () => {
  it('counts down with the PIN field disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => paused(60)));
    render(wrap(<AdminSignInCard onSignedIn={vi.fn()} />));
    fireEvent.change(document.querySelector('input[name="name"]')!, { target: { value: 'Grant' } });
    fireEvent.change(pinFields()[0], { target: { value: '0000' } });
    await act(async () => {
      fireEvent.submit(pinFields()[0].closest('form')!);
    });
    expect(screen.getByRole('alert').textContent).toBe("Let's pause a moment — try again in 1:00.");
    expect(pinFields()[0].disabled).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pinFields()[0].disabled).toBe(false);
  });
});

describe('RecoveryPinSheet (Update PIN)', () => {
  it('counts down on the current-PIN field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => paused(120)));
    render(
      wrap(
        <RecoveryPinSheet
          open
          onClose={vi.fn()}
          identity={{ name: 'Lin', token: 't', sessionId: '' }}
          hasPin
          authed
          onSaved={vi.fn()}
        />,
      ),
    );
    const [current, next, confirm] = pinFields();
    fireEvent.change(current, { target: { value: '0000' } });
    fireEvent.change(next, { target: { value: '5937' } });
    fireEvent.change(confirm, { target: { value: '5937' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update PIN' }));
    });
    expect(screen.getByRole('alert').textContent).toBe("Let's pause a moment — try again in 2:00.");
    expect(pinFields()[0].disabled).toBe(true);
    act(() => vi.advanceTimersByTime(120_000));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(pinFields()[0].disabled).toBe(false);
  });
});
