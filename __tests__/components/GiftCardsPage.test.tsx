// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import GiftCardsPage, { codeChars, creditLine, fmtCents } from '@/components/profile/GiftCardsPage';
import type { UseCredit } from '@/components/profile/useCredit';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { TOP_TOAST_EVENT, type TopToastRequest } from '@/lib/topToast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const loaded: UseCredit = {
  balanceCents: 1250,
  entries: [
    { id: 'spend:1', kind: 'credit_spend', amountCents: -1200, note: 'Session 2026-11-05', createdAt: '2026-11-06T20:00:00.000Z' },
    { id: 'gift:1', kind: 'gift_redeem', amountCents: 2500, note: 'Gift card · Raffle', createdAt: '2026-11-02T20:00:00.000Z' },
  ],
  loadError: false,
  reload: vi.fn(),
};

function renderPage(state: UseCredit = loaded) {
  const onBack = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <GiftCardsPage state={state} onBack={onBack} />
    </NextIntlClientProvider>,
  );
  return { onBack };
}

describe('creditLine', () => {
  it('names an entry by its kind, keeping only what a person typed', () => {
    expect(creditLine({ kind: 'gift_redeem', note: 'Gift card · Raffle' })).toEqual({ key: 'gift', detail: 'Raffle' });
    expect(creditLine({ kind: 'gift_redeem', note: 'Gift card' })).toEqual({ key: 'gift' });
    expect(creditLine({ kind: 'credit_spend', note: 'Session 2026-11-05' })).toEqual({ key: 'session', date: '2026-11-05' });
    expect(creditLine({ kind: 'credit_spend', note: 'Stringing' })).toEqual({ key: 'stringing' });
    expect(creditLine({ kind: 'credit_grant', note: 'Thanks for the shuttles' })).toEqual({ key: 'grant', detail: 'Thanks for the shuttles' });
    expect(creditLine({ kind: 'credit_refund', note: 'whatever the server says' })).toEqual({ key: 'refund' });
    expect(creditLine({ kind: 'something_new', note: 'x' })).toEqual({ key: 'other' });
  });
});

describe('fmtCents / codeChars', () => {
  it('reads money as a person does, signed on request', () => {
    expect(fmtCents(2500)).toBe('$25');
    expect(fmtCents(1250)).toBe('$12.50');
    expect(fmtCents(2500, true)).toBe('+$25');
    expect(fmtCents(-1200, true)).toBe('−$12');
  });
  it('ignores the dashes and spaces a reader adds', () => {
    expect(codeChars('ab12-cd34 ')).toBe('ab12cd34');
  });
});

describe('GiftCardsPage', () => {
  it('shows the credit, the redeem field and the history, newest first', () => {
    const { onBack } = renderPage();
    expect(screen.getByRole('heading', { name: 'Gift cards & credit' })).toBeTruthy();
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.getByText('Paid the Nov 5 session')).toBeTruthy();
    expect(screen.getByText('−$12')).toBeTruthy();
    expect(screen.getByText('Gift card · Raffle')).toBeTruthy();
    expect(screen.getByText('+$25')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('holds the place with skeletons while loading, never a $0', () => {
    renderPage({ balanceCents: null, entries: null, loadError: false, reload: vi.fn() });
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText('Your credit')).toBeNull();
    // The redeem field does not wait for the read.
    expect(screen.getByRole('textbox', { name: 'Gift card code' })).toBeTruthy();
  });

  it('says the read failed rather than showing a zero', () => {
    renderPage({ balanceCents: null, entries: null, loadError: true, reload: vi.fn() });
    expect(screen.getAllByText(/Couldn’t load your credit/)).toHaveLength(2);
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('says what an empty history means', () => {
    renderPage({ balanceCents: 0, entries: [], loadError: false, reload: vi.fn() });
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.getByText('No credit yet. A gift card adds it here.')).toBeTruthy();
  });

  it('redeems a code: clears the field, raises the toast and asks every balance to re-read', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ amountCents: 2500 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const toasts: TopToastRequest[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent<TopToastRequest>).detail);
    const onBalance = vi.fn();
    window.addEventListener(TOP_TOAST_EVENT, onToast);
    window.addEventListener(BALANCE_EVENT, onBalance);
    try {
      renderPage();
      const button = screen.getByRole('button', { name: 'Redeem' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const field = screen.getByRole('textbox', { name: 'Gift card code' }) as HTMLInputElement;
      fireEvent.change(field, { target: { value: 'abcd-1234' } });
      expect(field.value).toBe('ABCD-1234');
      await act(async () => {
        fireEvent.click(button);
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toMatch(/\/api\/credit\/redeem$/);
      expect(JSON.parse(init.body)).toEqual({ code: 'ABCD-1234' });
      expect(field.value).toBe('');
      expect(toasts.map((x) => x.title)).toEqual(['Added $25 to your credit']);
      expect(onBalance).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener(TOP_TOAST_EVENT, onToast);
      window.removeEventListener(BALANCE_EVENT, onBalance);
    }
  });

  it('one message for any code that did not work, another for too many tries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    const field = screen.getByRole('textbox', { name: 'Gift card code' });
    fireEvent.change(field, { target: { value: 'WXYZ9876' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/That code didn’t work/);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/give it a rest/);
  });
});
