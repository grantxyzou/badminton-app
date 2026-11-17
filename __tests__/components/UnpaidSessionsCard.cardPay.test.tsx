// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import UnpaidSessionsCard from '@/components/UnpaidSessionsCard';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';

/**
 * "Pay by card" in the store apps opens Stripe in the system browser sheet
 * over the app, not by navigating the WebView (which handed it to Safari and
 * came back to the website). The website keeps navigating.
 */
const { open, shell } = vi.hoisted(() => ({
  open: vi.fn(async (_opts: { url: string; presentationStyle?: string }) => undefined),
  shell: { native: false },
}));
vi.mock('@capacitor/browser', () => ({ Browser: { open } }));
// The shell is decided by lib/native (it reads `window.Capacitor`, which the
// real @capacitor/core rewrites when any plugin loads); the badge is not this test's.
vi.mock('@/lib/native', () => ({
  isNative: () => shell.native,
  hasNativePlugin: () => (shell.native ? true : null),
  nativePlatform: () => (shell.native ? 'ios' : null),
}));
vi.mock('@/lib/appBadge', () => ({ syncAppBadge: () => undefined, owedBadgeCount: () => 0 }));
// The card fee's in-app form, as a marker: this file tests only that the button opens it.
vi.mock('@/components/payments/CardPaySheet', () => ({ default: ({ open }: { open: boolean }) => (open ? <div data-testid="card-pay-sheet" /> : null) }));

const OWED = {
  totalOwed: 12.5,
  sessionCount: 1,
  mostRecent: { sessionId: 's1', date: '2026-11-12T19:00:00-08:00', owedAmount: 12.5 },
  sessions: [{ sessionId: 's1', date: '2026-11-12T19:00:00-08:00', owedAmount: 12.5 }],
  cardPay: true,
};
const URL_ = 'https://checkout.stripe.com/c/pay/cs_test_1';

function stub() {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/payments/card/checkout') && init?.method === 'POST') {
      return new Response(JSON.stringify({ url: URL_ }), { status: 200 });
    }
    return new Response(JSON.stringify(OWED), { status: 200 });
  });
}

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  open.mockClear();
  shell.native = false;
});

describe('Pay by card', () => {
  it('in the app: asks for the app return and opens the sheet; coming back re-reads the balance', async () => {
    shell.native = true;
    const fetchSpy = stub();
    const changed = vi.fn();
    window.addEventListener(BALANCE_EVENT, changed);
    wrap(<UnpaidSessionsCard name="Lin" />);
    fireEvent.click(await screen.findByRole('button', { name: /Pay by card/ }));
    await waitFor(() => expect(open).toHaveBeenCalledWith({ url: URL_, presentationStyle: 'popover' }));
    const post = fetchSpy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse(String((post![1] as RequestInit).body))).toEqual({ native: true });

    window.dispatchEvent(new Event('bpm:resume'));
    expect(changed).toHaveBeenCalledTimes(1);
    // Once only: a later resume is not this payment's.
    window.dispatchEvent(new Event('bpm:resume'));
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(BALANCE_EVENT, changed);
  });

  it('on the website: no body, and no sheet', async () => {
    const fetchSpy = stub();
    wrap(<UnpaidSessionsCard name="Lin" />);
    fireEvent.click(await screen.findByRole('button', { name: /Pay by card/ }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(true),
    );
    const post = fetchSpy.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST');
    expect((post![1] as RequestInit).body).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });

  it('with a card fee: says so under the button, and the button opens the in-app form, not Stripe’s page', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ ...OWED, cardFee: { bps: 240 } }), { status: 200 }),
    );
    wrap(<UnpaidSessionsCard name="Lin" />);
    expect((await screen.findByTestId('card-fee-note')).textContent).toBe('Credit cards add 2.4%. Debit cards pay no fee.');
    fireEvent.click(screen.getByRole('button', { name: /Pay by card/ }));
    expect(await screen.findByTestId('card-pay-sheet')).toBeTruthy();
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
