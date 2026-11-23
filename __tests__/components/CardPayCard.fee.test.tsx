// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import CardPayCard from '@/components/admin/CommandCenter/CardPayCard';

/** The organiser's card-fee switch (docs/plans/card-surcharge.md): on only after the rules sheet's box is ticked. */
function serve(initial: Record<string, unknown>) {
  const patches: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      return new Response(JSON.stringify({ surcharge: { on: body.surcharge.on, bps: body.surcharge.bps ?? 240, updatedAt: 'x' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ connected: true, chargesEnabled: true, stripeAccountId: 'acct_1', cardFormReady: true, surcharge: null, ...initial }), { status: 200 });
  }));
  return patches;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CardPayCard — the card fee', () => {
  it('off by default; turning it on opens the rules, and Turn on waits for the box', async () => {
    const patches = serve({});
    render(<CardPayCard />);
    expect(await screen.findByText(/Off · the club pays Stripe’s fee/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Card fee on credit cards' }));
    const confirm = await screen.findByTestId('card-fee-confirm');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('card-fee-told'));
    fireEvent.click(confirm);
    await waitFor(() => expect(patches[0]).toEqual({ surcharge: { on: true, bps: 240, acknowledged: true } }));
    expect(await screen.findByText(/On · Visa and Mastercard credit cards pay 2.4% more/)).toBeTruthy();
  });

  it('turning it off needs no sheet', async () => {
    const patches = serve({ surcharge: { on: true, bps: 240, acknowledgedAt: 'x' } });
    render(<CardPayCard />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Card fee on credit cards' }));
    await waitFor(() => expect(patches[0]).toEqual({ surcharge: { on: false } }));
  });

  it('cannot be turned on before the server has the key the card form needs', async () => {
    serve({ cardFormReady: false });
    render(<CardPayCard />);
    expect(((await screen.findByRole('switch', { name: 'Card fee on credit cards' })) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/STRIPE_PUBLISHABLE_KEY/)).toBeTruthy();
  });
});

describe('CardPayCard — the Stripe receipt tip', () => {
  it('once the club takes cards, says where to turn off Stripe’s own receipt', async () => {
    serve({});
    render(<CardPayCard />);
    const tip = await screen.findByTestId('stripe-receipt-tip');
    expect(tip.textContent).toMatch(/switch off Successful payments\. Leave Refunds on\./);
    expect(tip.querySelector('a')?.getAttribute('href')).toBe('https://dashboard.stripe.com/settings/emails');
  });

  it('not while Stripe setup is unfinished', async () => {
    serve({ chargesEnabled: false });
    render(<CardPayCard />);
    await screen.findByText(/Stripe still needs a few details/);
    expect(screen.queryByTestId('stripe-receipt-tip')).toBeNull();
  });
});
