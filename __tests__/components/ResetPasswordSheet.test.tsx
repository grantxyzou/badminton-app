// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ResetPasswordSheet from '../../components/auth/ResetPasswordSheet';
import enMessages from '../../messages/en.json';

const request = { token: 'tok123', email: 'lin@example.com' };
const onDone = vi.fn();
const onNeedNewLink = vi.fn();

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

function open(password = 'a good long password', confirm?: string) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ResetPasswordSheet
        open
        request={request}
        sessionId="session-1"
        onClose={() => {}}
        onDone={onDone}
        onNeedNewLink={onNeedNewLink}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Type it again'), {
    target: { value: confirm ?? password },
  });
}

beforeEach(() => {
  localStorage.clear();
  onDone.mockClear();
  onNeedNewLink.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ResetPasswordSheet', () => {
  it('signs the user in on success — they just proved control of the mailbox', async () => {
    respond(200, { ok: true, id: 'm1', name: 'Lin' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save it' }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(localStorage.getItem('badminton_identity')!).name).toBe('Lin');
  });

  it('offers a fresh link when the token is dead', async () => {
    respond(400, { error: 'invalid_token' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Save it' }));

    expect(await screen.findByText(/already been used, or it's expired/i)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Get a new link' }));
    expect(onNeedNewLink).toHaveBeenCalled();
  });

  it('keeps the user in place on a weak password and says the link still works', async () => {
    // The route validates strength BEFORE touching the token, so the link is
    // still good. Sending them off for a replacement would waste the one they
    // hold and is simply untrue.
    //
    // The password here PASSES the client mirror on purpose: the server is
    // authoritative and may be stricter (a raised minimum, a longer blocklist),
    // and this asserts the mapping for that case. A client-blocked password
    // never reaches the server at all — covered by the mismatch test below.
    respond(400, { error: 'weak_password', reason: 'Use at least 10 characters.' });
    open('a good long password');
    fireEvent.click(screen.getByRole('button', { name: 'Save it' }));

    expect(await screen.findByText(/Your link still works/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Get a new link' })).toBeNull();
  });

  it('blocks a client-detectable weak password before any request', () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    open('badminton1'); // in the shared blocklist
    expect(screen.getByText(/easy to guess/i)).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
  });

  it('blocks a mismatch before any request', () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    open('a good long password', 'a different password');
    expect(screen.getByText(/don't match yet/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save it' })).toHaveProperty('disabled', true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('never renders the server’s English reason string', async () => {
    // It would appear untranslated in zh-CN.
    respond(400, { error: 'weak_password', reason: 'Use at least 10 characters.' });
    open('a good long password');
    fireEvent.click(screen.getByRole('button', { name: 'Save it' }));
    await screen.findByText(/Your link still works/i);
    expect(screen.queryByText('Use at least 10 characters.')).toBeNull();
  });
});
