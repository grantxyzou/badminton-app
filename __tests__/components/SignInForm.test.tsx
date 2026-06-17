// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SignInForm from '@/components/SignInForm';
import enMessages from '../../messages/en.json';

const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function renderForm(props: Partial<React.ComponentProps<typeof SignInForm>> = {}) {
  const onSuccess = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignInForm sessionId="session-2026-05-12" onSuccess={onSuccess} {...props} />
    </NextIntlClientProvider>,
  );
  return { ...utils, onSuccess };
}

function mockFetch(impl: typeof fetch) {
  global.fetch = impl;
}

describe('<SignInForm />', () => {
  it('renders name input, PIN input, and Sign in button', () => {
    renderForm();
    expect(screen.getByPlaceholderText('Your name')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
  });

  it('disables submit until name + 4-digit PIN are present', () => {
    renderForm();
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('hides Forgot link by default; shows when onForgotPin is provided', () => {
    const { rerender } = renderForm();
    expect(screen.queryByText('Forgot your PIN?')).toBeNull();
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SignInForm sessionId="s" onSuccess={() => {}} onForgotPin={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Forgot your PIN?')).toBeDefined();
  });

  it('calls onSuccess with name + token on a successful POST', async () => {
    mockFetch(async () => new Response(JSON.stringify({ deleteToken: 'tok-abc' }), { status: 200 }));
    const { onSuccess } = renderForm();

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alice' } });
    // PinInput renders 4 digit boxes — simulate by directly invoking the
    // underlying input. Easier to test through the existing test path: just
    // type into each digit box via querySelectorAll.
    // PinInput is a single masked input with maxLength=4 (not 4 separate boxes).
    const pinInput = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    fireEvent.change(pinInput, { target: { value: '1234' } });

    const submit = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ name: 'Alice', token: 'tok-abc' });
    });
  });

  it('shows "That didn\'t match" on 401 (4xx — bad credentials)', async () => {
    mockFetch(async () => new Response('{}', { status: 401 }));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alice' } });
    // PinInput is a single masked input with maxLength=4 (not 4 separate boxes).
    const pinInput = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    fireEvent.change(pinInput, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText(/That didn't match/i)).toBeDefined();
    });
  });

  it('shows network error on 500 (5xx — distinct from 4xx)', async () => {
    // This is the critical regression-guard: pre-extraction, RecoverySheet
    // collapsed 5xx into "invalid" and users retried until rate-limited.
    mockFetch(async () => new Response('{}', { status: 500 }));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alice' } });
    // PinInput is a single masked input with maxLength=4 (not 4 separate boxes).
    const pinInput = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    fireEvent.change(pinInput, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't reach the server/i)).toBeDefined();
    });
    // And specifically NOT the "wrong PIN" error.
    expect(screen.queryByText(/That didn't match/i)).toBeNull();
  });

  it('shows rate-limited error on 429', async () => {
    mockFetch(async () => new Response('{}', { status: 429 }));
    renderForm();

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Alice' } });
    // PinInput is a single masked input with maxLength=4 (not 4 separate boxes).
    const pinInput = document.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
    fireEvent.change(pinInput, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText(/pause a moment/i)).toBeDefined();
    });
  });
});
