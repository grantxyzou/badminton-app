// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import EmailCodeSignInForm from '@/components/auth/EmailCodeSignInForm';

/**
 * Log in with a code emailed to you (docs/plans/one-way-in.md, step 3): the
 * address, then the code, with the password a tap away.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(verifyStatus = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.endsWith('/email-code/start')) return json({ ok: true });
    if (url.endsWith('/email-code/verify')) {
      return verifyStatus === 200 ? json({ name: 'Akane' }) : json({ error: 'invalid_code' }, verifyStatus);
    }
    return json({});
  }));
  return calls;
}

function renderForm(onSuccess = vi.fn(), onForgotPassword = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmailCodeSignInForm onSuccess={onSuccess} onForgotPassword={onForgotPassword} />
    </NextIntlClientProvider>,
  );
  return { onSuccess, onForgotPassword };
}

async function sendTo(email: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }));
  });
}

describe('EmailCodeSignInForm', () => {
  it('sends the code, says so without claiming the address has an account, then logs in', async () => {
    const calls = stub();
    const { onSuccess } = renderForm();
    await sendTo(' akane@example.com ');

    expect(calls[0]).toMatchObject({ body: { email: 'akane@example.com' } });
    expect(screen.getByRole('status').textContent).toMatch(/^If akane@example\.com has an account, a 6-digit code is on its way/);

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123 456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    });
    expect(calls[1]).toMatchObject({ body: { email: 'akane@example.com', code: '123456' } });
    expect(onSuccess).toHaveBeenCalledWith({ name: 'Akane' });
  });

  it('keeps Log in off until six digits are typed, and drops anything else', async () => {
    stub();
    renderForm();
    await sendTo('akane@example.com');
    const field = screen.getByLabelText('6-digit code') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '12ab3' } });
    expect(field.value).toBe('123');
    expect((screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a refused code did not work, in one sentence for every refusal', async () => {
    stub(401);
    const { onSuccess } = renderForm();
    await sendTo('akane@example.com');
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    });
    expect(screen.getByRole('alert').textContent).toBe(enMessages.profile.auth.codeInvalid);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('can send a new code, or go back to change the address', async () => {
    const calls = stub();
    renderForm();
    await sendTo('akane@example.com');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    });
    expect(calls.filter((c) => c.url.endsWith('/start'))).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();
  });

  it('says when there have been too many tries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'rate_limited' }, 429)));
    renderForm();
    await sendTo('akane@example.com');
    expect(screen.getByRole('alert').textContent).toBe(enMessages.profile.auth.codeRateLimited);
  });

  it('offers the password a tap away, with its own forgot link, and back again', () => {
    stub();
    const { onForgotPassword } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Use my password instead' }));
    expect(screen.getByLabelText('Password')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(onForgotPassword).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }));
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeDefined();
  });
});
