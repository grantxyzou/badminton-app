// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import AdminTab from '../../components/AdminTab';
import enMessages from '../../messages/en.json';

/**
 * The shell's own `GET /api/admin` already said yes, so the console draws at
 * once and this tab's check runs behind it (2026-10-25: Admin's first open
 * waited on the same question twice before any console read began). A refusal
 * still swaps in the PIN form.
 */
function stubAdminCheck(answer: Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/admin')) return answer;
      return new Promise<Response>(() => {});
    }),
  );
}
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

function renderTab(knownAuthed?: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AdminTab onExit={() => {}} knownAuthed={knownAuthed} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminTab knownAuthed', () => {
  it('without it, the tab waits on its own check before drawing the console', () => {
    stubAdminCheck(new Promise<Response>(() => {}));
    renderTab();
    expect(screen.getByLabelText('Loading')).toBeDefined();
    expect(screen.queryByRole('button', { name: /E-transfers|Sign-in readiness/ })).toBeNull();
  });

  it('with it, the console draws before the check answers', async () => {
    stubAdminCheck(new Promise<Response>(() => {}));
    renderTab(true);
    expect(await screen.findByRole('button', { name: /Sign-in readiness/ })).toBeDefined();
  });

  it('a refusal behind it still swaps in the PIN form', async () => {
    stubAdminCheck(Promise.resolve(json(200, { authed: false })));
    renderTab(true);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sign-in readiness/ })).toBeNull());
    expect(document.querySelector('input')).not.toBeNull();
  });

  it('a failed check behind it leaves the console up', async () => {
    stubAdminCheck(Promise.reject(new Error('offline')));
    renderTab(true);
    expect(await screen.findByRole('button', { name: /Sign-in readiness/ })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
