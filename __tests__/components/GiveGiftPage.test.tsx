// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import GiveGiftPage from '@/components/profile/GiveGiftPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const GRANT = { memberId: 'm-grant', name: 'Grant' };
const CARDS = [
  {
    id: 'g1', amountCents: 2500, note: 'Raffle', hint: 'AB12', createdAt: '2026-11-01T20:00:00.000Z', redeemedAt: '2026-11-03T20:00:00.000Z',
    createdBy: GRANT, redeemedBy: { memberId: 'm-lin', name: 'Lin' }, usedCents: 1200, remainingCents: 1300,
    uses: [
      { at: '2026-11-05T20:00:00.000Z', amountCents: 1200, note: 'Session 2026-11-05', kind: 'credit_spend', reversed: false },
      { at: '2026-11-06T20:00:00.000Z', amountCents: 500, note: '', kind: 'credit_spend', reversed: true },
    ],
  },
  {
    id: 'g2', amountCents: 1000, note: '', hint: 'CD34', createdAt: '2026-11-04T20:00:00.000Z', redeemedAt: null,
    createdBy: GRANT, redeemedBy: null, usedCents: null, remainingCents: null, uses: [],
  },
];
/** What a server from before 2026-11-12 sent: no record. */
const OLD_CARDS = [
  { id: 'g1', amountCents: 2500, note: 'Raffle', hint: 'AB12', createdAt: '2026-11-01T20:00:00.000Z', redeemedAt: '2026-11-03T20:00:00.000Z' },
  { id: 'g2', amountCents: 1000, note: '', hint: 'CD34', createdAt: '2026-11-04T20:00:00.000Z', redeemedAt: null },
];
let listed: unknown[] = CARDS;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listed = CARDS;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ code: 'WXYZ-9876', amountCents: body.amountCents, note: body.note }), { status: 200 });
    }
    return new Response(JSON.stringify({ canGift: true, cards: listed }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

async function renderPage() {
  const onBack = vi.fn();
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        <GiveGiftPage clubName="BPM Core" onBack={onBack} />
      </NextIntlClientProvider>,
    );
  });
  return { onBack };
}

async function make(amount = '$25') {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: `Make a ${amount} credit code` }));
  });
}

describe('GiveGiftPage', () => {
  it('lists the codes you made: who redeemed each, what is left, and when it was given', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Give credit' })).toBeTruthy();
    expect(screen.getByText('Redeemed by Lin')).toBeTruthy();
    expect(screen.getByText('$13 left · Given Nov 1 · …AB12 · Raffle')).toBeTruthy();
    expect(screen.getByText('Not redeemed yet')).toBeTruthy();
    expect(screen.getByText('Given Nov 4 · …CD34')).toBeTruthy();
  });

  it("opens a code into its record: made, redeemed, used and left, and where it was spent (review of 2026-11-12)", async () => {
    await renderPage();
    const row = screen.getByRole('button', { name: /Redeemed by Lin/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Nov 3 by Lin')).toBeNull();
    await act(async () => {
      fireEvent.click(row);
    });
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Nov 1 by Grant')).toBeTruthy();
    expect(screen.getByText('Nov 3 by Lin')).toBeTruthy();
    expect(screen.getByText('$12 of $25 · $13 left')).toBeTruthy();
    const uses = screen.getByRole('list', { name: 'Where it was spent' });
    expect(uses.textContent).toContain('Nov 5 · Session 2026-11-05');
    expect(uses.textContent).toContain('Nov 6 · Spent · refunded');
    // The unredeemed one says so, and has nothing spent.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Not redeemed yet/ }));
    });
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText('Nov 4 by Grant')).toBeTruthy();
  });

  it('a server from before the record still lists dates, never a blank name', async () => {
    listed = OLD_CARDS;
    await renderPage();
    expect(screen.getByText('Redeemed Nov 3')).toBeTruthy();
    expect(screen.getByText('Given Nov 1 · …AB12 · Raffle')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Redeemed Nov 3/ }));
    });
    expect(screen.queryByText(/ by /)).toBeNull();
    expect(screen.queryByText('Used')).toBeNull();
  });

  it('offers $10, $25 and $50, with $25 chosen, and sends the one picked', async () => {
    await renderPage();
    const chips = screen.getAllByRole('radio');
    expect(chips.map((c) => c.textContent)).toEqual(['$10', '$25', '$50']);
    expect(screen.getByRole('radio', { name: '$25' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '$50' }));
    fireEvent.change(screen.getByPlaceholderText('Raffle, thank-you…'), { target: { value: 'Thanks' } });
    await make('$50');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(String(post[0])).toMatch(/\/api\/giftcards$/);
    expect(JSON.parse(String(post[1]!.body))).toEqual({ amountCents: 5000, note: 'Thanks' });
    expect(screen.getByText('BPM Core credit · $50')).toBeTruthy();
    expect(screen.getByText('WXYZ-9876')).toBeTruthy();
  });

  it('asks before leaving a code nobody copied', async () => {
    const { onBack } = await renderPage();
    await make();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText('Leave without the code?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave anyway' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('leaves at once once the code is copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { onBack } = await renderPage();
    await make();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(writeText).toHaveBeenCalledWith('WXYZ-9876');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByText('Leave without the code?')).toBeNull();
  });

  it('says so when the switch is off for this member', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Response('{}', { status: 403 })
        : new Response(JSON.stringify({ canGift: false, cards: [] }), { status: 200 }),
    );
    await renderPage();
    expect(screen.getByText('No codes yet.')).toBeTruthy();
    await make();
    expect(screen.getByRole('alert').textContent).toBe('Only organisers can give credit.');
  });

  it('says the list failed to load rather than showing none', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    await renderPage();
    expect(screen.getByText('Couldn’t load your codes.')).toBeTruthy();
    expect(screen.queryByText('No codes yet.')).toBeNull();
  });
});
