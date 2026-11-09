// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SignInForm from '../../components/SignInForm';
import enMessages from '../../messages/en.json';

/**
 * Enter in the PIN field, or the phone keyboard's Go key, signs in (#825).
 * The form was a <div> with a type="button", so both did nothing while the
 * email sign-in on the same page, a real <form>, submitted. jsdom does not do
 * implicit submission on a key press, so the test drives the form's submit
 * event, which is what a browser fires for Enter / Go.
 */
function renderForm(onSuccess = vi.fn()) {
  const view = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignInForm sessionId="" onSuccess={onSuccess} probeName={false} />
    </NextIntlClientProvider>,
  );
  return { view, onSuccess };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SignInForm submits as a form', () => {
  it('signs in when the form is submitted (Enter / Go), not only on a click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deleteToken: null }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { view, onSuccess } = renderForm();

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '2468' } });
    const form = view.container.querySelector('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ name: 'Lin', token: null }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/players/recover');
  });

  it('does nothing on submit while the PIN is incomplete', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { view } = renderForm();

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Lin' } });
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '24' } });
    fireEvent.submit(view.container.querySelector('form')!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps "Forgot PIN" a plain button so it never submits', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <SignInForm sessionId="" onSuccess={vi.fn()} onForgotPin={vi.fn()} probeName={false} />
      </NextIntlClientProvider>,
    );
    const submit = screen.getByRole('button', { name: 'Sign in' });
    expect(submit.getAttribute('type')).toBe('submit');
    for (const b of screen.getAllByRole('button')) {
      if (b !== submit) expect(b.getAttribute('type')).toBe('button');
    }
  });
});
