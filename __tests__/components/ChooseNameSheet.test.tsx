// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ChooseNameSheet from '../../components/auth/ChooseNameSheet';
import enMessages from '../../messages/en.json';

/**
 * The name step after a provider sign-in that has no member yet.
 *
 * The case this file was written for: the signed `pending_signup` cookie
 * expires. The sheet used to ignore that, let someone choose a name, commit to
 * it, and only then fail — with copy telling them to "tap the button again"
 * when the sheet contained no such button. A dead end, found by using it.
 */
const onClose = vi.fn();

function routes(overrides: {
  get?: () => Promise<Response>;
  post?: () => Promise<Response>;
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const isPost = (init?.method ?? 'GET') === 'POST';
      if (String(url).includes('/api/auth/complete-signup')) {
        return isPost
          ? (overrides.post?.() ??
              Promise.resolve({ ok: true, json: async () => ({ name: 'Carolina' }) } as Response))
          : (overrides.get?.() ??
              Promise.resolve({
                ok: true,
                json: async () => ({ pending: true, suggestedName: null }),
              } as Response));
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }),
  );
}

function open() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChooseNameSheet open onClose={onClose} sessionId="session-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  onClose.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ChooseNameSheet', () => {
  it('asks for a name when a pending signup exists', async () => {
    routes({});
    open();
    expect(await screen.findByText('What should we call you?')).toBeDefined();
  });

  it('prefills the name a provider supplied (Apple sends it once, ever)', async () => {
    routes({
      get: () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ pending: true, suggestedName: 'Carolina Marin' }),
        } as Response),
    });
    open();
    await waitFor(() =>
      expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe(
        'Carolina Marin',
      ),
    );
  });

  it('says so IMMEDIATELY when the pending signup has expired', async () => {
    // Not after they have typed a name and pressed the button. The GET already
    // knows.
    routes({
      get: () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ pending: false, suggestedName: null }),
        } as Response),
    });
    open();
    expect(await screen.findByText("Let's start that again")).toBeDefined();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('offers a real way out of the expired state', async () => {
    routes({
      get: () =>
        Promise.resolve({
          ok: true,
          json: async () => ({ pending: false }),
        } as Response),
    });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Back to sign-in' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('falls into the expired state if the cookie dies between opening and submitting', async () => {
    routes({
      post: () =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: async () => ({ error: 'no_pending_signup' }),
        } as Response),
    });
    open();
    fireEvent.change(await screen.findByLabelText('Your name'), {
      target: { value: 'Carolina' },
    });
    fireEvent.click(screen.getByRole('button', { name: "That's me" }));

    expect(await screen.findByText("Let's start that again")).toBeDefined();
  });

  it('offers to prove ownership when the name is taken', async () => {
    routes({
      post: () =>
        Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({ error: 'name_taken' }),
        } as Response),
    });
    open();
    fireEvent.change(await screen.findByLabelText('Your name'), {
      target: { value: 'Grant' },
    });
    fireEvent.click(screen.getByRole('button', { name: "That's me" }));

    // A refusal with a route forward, not a dead end.
    expect(await screen.findByText('Is that you?')).toBeDefined();
    expect(screen.getByLabelText('Your 4-digit PIN')).toBeDefined();
  });
});
