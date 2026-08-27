// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import EmailSignInForm from '../../components/auth/EmailSignInForm';
import EmailSignUpSheet from '../../components/auth/EmailSignUpSheet';
import ForgotPasswordSheet from '../../components/auth/ForgotPasswordSheet';
import enMessages from '../../messages/en.json';

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function respond(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EmailSignInForm', () => {
  const onSuccess = vi.fn();
  const onForgot = vi.fn();
  beforeEach(() => {
    onSuccess.mockClear();
    onForgot.mockClear();
  });

  function fill() {
    wrap(<EmailSignInForm onSuccess={onSuccess} onForgotPassword={onForgot} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  }

  it('succeeds on a response with NO deleteToken', async () => {
    // The exact trap that makes this a separate component: SignInForm rejects a
    // successful account-level sign-in because it hard-gates on deleteToken.
    respond(200, { id: 'm1', name: 'Lin', role: 'member' });
    fill();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ name: 'Lin' }));
  });

  it('shows one message for wrong password and unknown address alike', async () => {
    // The server answers identically for both on purpose; splitting them here
    // would undo the anti-enumeration property.
    respond(401, { error: 'invalid_credentials' });
    fill();
    expect(await screen.findByText(/don't match/i)).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('distinguishes rate-limited from wrong credentials', async () => {
    respond(429, { error: 'rate_limited' });
    fill();
    expect(await screen.findByText(/give it a rest for an hour/i)).toBeDefined();
  });

  it('reports a malformed success as a service failure, not bad credentials', async () => {
    // A 200 with no `name` is genuinely broken. Saying "wrong password" would
    // send the user chasing a credential that is fine.
    respond(200, { ok: true });
    fill();
    expect(await screen.findByText(/Couldn't reach us/i)).toBeDefined();
  });

  it('surfaces the forgot-password entry', () => {
    wrap(<EmailSignInForm onSuccess={onSuccess} onForgotPassword={onForgot} />);
    fireEvent.click(screen.getByRole('button', { name: /Forgot your password/i }));
    expect(onForgot).toHaveBeenCalled();
  });
});

describe('EmailSignUpSheet', () => {
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  beforeEach(() => {
    onSuccess.mockClear();
    onClose.mockClear();
  });

  function fill(password: string) {
    wrap(<EmailSignUpSheet open onClose={onClose} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Carolina' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'c@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  }

  it('blocks a short password WITHOUT issuing a request', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    fill('short');
    expect(await screen.findByText(/at least 10 characters/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Create it' })).toHaveProperty('disabled', true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('gives name_taken and email_taken DIFFERENT copy', async () => {
    respond(409, { error: 'name_taken' });
    fill('a good long password');
    fireEvent.click(screen.getByRole('button', { name: 'Create it' }));
    expect(await screen.findByText(/already plays under that name/i)).toBeDefined();
    cleanup();

    respond(409, { error: 'email_taken' });
    fill('a good long password');
    fireEvent.click(screen.getByRole('button', { name: 'Create it' }));
    expect(await screen.findByText(/already has an account/i)).toBeDefined();
  });

  it('says plainly when the confirmation email could not be sent', async () => {
    // The account is real either way; closing silently would imply mail is on
    // its way when the route explicitly reported it is not.
    respond(201, { id: 'm1', name: 'Carolina', verificationSent: false });
    fill('a good long password');
    fireEvent.click(screen.getByRole('button', { name: 'Create it' }));
    expect(await screen.findByText(/couldn't send the confirmation email/i)).toBeDefined();
    expect(onSuccess).toHaveBeenCalledWith({ name: 'Carolina' });
  });
});

describe('ForgotPasswordSheet', () => {
  function ask() {
    wrap(<ForgotPasswordSheet open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send the link' }));
  }

  it('shows the conditional confirmation on success', async () => {
    // Conditional wording, because the endpoint always answers 200 whether or
    // not the address exists — the UI must not resolve that ambiguity either.
    respond(200, { ok: true, message: 'ignored — English prose from the server' });
    ask();
    expect(await screen.findByText(/If that address has an account/i)).toBeDefined();
  });

  it('does NOT claim anything was sent when the request failed', async () => {
    // Nothing left the building; the neutral confirmation would leave someone
    // waiting on mail that does not exist.
    respond(503, { error: 'service_unavailable' });
    ask();
    expect(await screen.findByText(/Couldn't send that just now/i)).toBeDefined();
    expect(screen.queryByText(/If that address has an account/i)).toBeNull();
  });

  it('distinguishes rate-limited', async () => {
    respond(429, { error: 'rate_limited' });
    ask();
    expect(await screen.findByText(/give it a rest for a few minutes/i)).toBeDefined();
  });
});
