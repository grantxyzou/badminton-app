// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import CommandCenter from '../../components/admin/CommandCenter/CommandCenter';
import SignInReadinessCard from '../../components/admin/CommandCenter/SignInReadinessCard';
import enMessages from '../../messages/en.json';

/**
 * Sign-in readiness and the e-transfer inbox left the console body for the
 * menu (Grant, 2026-10-21: "should be moved into menu items"). Each row has
 * to still carry the number its card was there for, and open the page — the
 * same question AdminMetricsEntry.test.tsx asks of Metrics.
 */
function stubFetch(byUrl: (url: string) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = byUrl(url);
      return body === undefined
        ? ({ ok: false, status: 404, json: async () => ({}) } as Response)
        : ({ ok: true, status: 200, json: async () => body } as Response);
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
});

function renderConsole(setView = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CommandCenter refreshKey={0} setView={setView} onExit={() => {}} />
    </NextIntlClientProvider>,
  );
  return setView;
}

describe('Sign-in readiness and E-transfers are menu rows', () => {
  it('the People row says how many are locked out and opens the page', async () => {
    stubFetch((url) => {
      if (url.includes('/api/admin/sign-in-readiness')) return { total: 36, ready: 34, cannotSignIn: ['Jimmy', 'Nathan'] };
      return {};
    });
    const setView = renderConsole();
    const row = await screen.findByRole('button', { name: /Sign-in readiness/ });
    await waitFor(() => expect(row.textContent).toMatch(/2 locked out/));
    // The card itself is no longer in the body.
    expect(screen.queryByText(/locked out until you let them in/)).toBeNull();
    row.click();
    expect(setView).toHaveBeenCalledWith('sign-in-readiness');
  });

  it('with nobody locked out the row carries no count, and a dead read never says 0', async () => {
    stubFetch((url) => (url.includes('/api/admin/sign-in-readiness') ? undefined : {}));
    renderConsole();
    const row = await screen.findByRole('button', { name: /Sign-in readiness/ });
    expect(row.textContent).not.toMatch(/locked out/);
  });

  it('the Money row says what is waiting in the inbox and opens the page', async () => {
    stubFetch((url) => {
      if (url.includes('/api/admin/payments')) return { configured: true, review: [{}, {}, {}] };
      return {};
    });
    const setView = renderConsole();
    const row = await screen.findByRole('button', { name: /E-transfers/ });
    await waitFor(() => expect(row.textContent).toMatch(/3 waiting/));
    expect(screen.queryByText(/Stop ticking people off/)).toBeNull();
    row.click();
    expect(setView).toHaveBeenCalledWith('etransfers');
  });

  it('an inbox not set up yet says so on the row', async () => {
    stubFetch((url) => (url.includes('/api/admin/payments') ? { configured: false, review: [] } : {}));
    renderConsole();
    const row = await screen.findByRole('button', { name: /E-transfers/ });
    await waitFor(() => expect(row.textContent).toMatch(/Set up/));
  });

  it('with the payments flag off there is no E-transfers row', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
    stubFetch(() => ({}));
    renderConsole();
    await screen.findByRole('button', { name: /Sign-in readiness/ });
    expect(screen.queryByRole('button', { name: /E-transfers/ })).toBeNull();
  });
});

describe('Sign-in readiness on its own page', () => {
  it('says everyone can sign in instead of rendering nothing', async () => {
    stubFetch(() => ({ total: 5, ready: 5, cannotSignIn: [] }));
    render(<SignInReadinessCard standalone />);
    expect(await screen.findByText(/5.*members can sign in|of 5 members can sign in/)).toBeDefined();
    expect(screen.getByText(/Nobody is locked out/)).toBeDefined();
  });

  it('holds its place while the list loads', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const { container } = render(<SignInReadinessCard standalone />);
    expect(container.firstChild).not.toBeNull();
  });
});
