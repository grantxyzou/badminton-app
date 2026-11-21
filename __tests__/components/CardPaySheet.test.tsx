// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import CardPaySheet from '@/components/payments/CardPaySheet';

/**
 * The in-app card form for a club with a card fee (docs/plans/card-surcharge.md):
 * the fee is SHOWN before anything is charged, debit shows no fee, and Pay
 * charges the quoted intent. Stripe.js is a stand-in.
 */
const { stripe } = vi.hoisted(() => ({
  stripe: {
    elements: () => ({ create: () => ({ mount: () => undefined, unmount: () => undefined, destroy: () => undefined }) }),
    createPaymentMethod: vi.fn(async () => ({ paymentMethod: { id: 'pm_card_visa_1' } })),
    handleNextAction: vi.fn(async () => ({ paymentIntent: { status: 'succeeded' } })),
  },
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: async () => stripe }));

const START = { publishableKey: 'pk_test_1', stripeAccount: 'acct_1', amountCents: 2700, currency: 'cad', lines: 2, bps: 240 };
const credit = { intentId: 'pi_1', baseCents: 2700, feeCents: 64, totalCents: 2764, bps: 240, funding: 'credit', brand: 'visa', last4: '4242' };

function serve(quote: Record<string, unknown>, confirm: Record<string, unknown> = { status: 'succeeded', clientSecret: 'pi_1_secret' }) {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const out = body.step === 'start' ? START : body.step === 'quote' ? quote : confirm;
    return new Response(JSON.stringify(out), { status: 200 });
  }));
  return calls;
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
      <CardPaySheet open onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  stripe.createPaymentMethod.mockClear();
  stripe.handleNextAction.mockClear();
});

describe('CardPaySheet', () => {
  it('a credit card: the fee and the total are shown before Pay, and Pay charges the quoted intent', async () => {
    const calls = serve(credit);
    wrap();
    expect(await screen.findByText(/A Visa or Mastercard credit card adds a 2.4% card fee/)).toBeTruthy();
    fireEvent.click(await screen.findByTestId('card-pay-continue'));
    const review = await screen.findByTestId('card-pay-review');
    expect(review.textContent).toContain('Card fee (2.4%, credit card)');
    expect(review.textContent).toContain('$0.64');
    expect(review.textContent).toContain('$27.64');
    expect(calls[1]).toEqual({ step: 'quote', paymentMethodId: 'pm_card_visa_1' });

    fireEvent.click(screen.getByTestId('card-pay-confirm'));
    expect(await screen.findByText(/Paid\. Your balance updates/)).toBeTruthy();
    expect(calls[2]).toEqual(expect.objectContaining({ step: 'confirm', intentId: 'pi_1' }));
    expect(stripe.handleNextAction).not.toHaveBeenCalled();
  });

  it('a debit card: no card fee', async () => {
    serve({ ...credit, feeCents: 0, totalCents: 2700, funding: 'debit' });
    wrap();
    fireEvent.click(await screen.findByTestId('card-pay-continue'));
    const review = await screen.findByTestId('card-pay-review');
    expect(review.textContent).toContain('No card fee');
    expect(screen.getByTestId('card-pay-confirm').textContent).toContain('Pay $27');
  });

  it('a card check (3-D Secure) is finished in Stripe’s own window', async () => {
    serve(credit, { status: 'requires_action', clientSecret: 'pi_1_secret' });
    wrap();
    fireEvent.click(await screen.findByTestId('card-pay-continue'));
    fireEvent.click(await screen.findByTestId('card-pay-confirm'));
    await waitFor(() => expect(stripe.handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret' }));
    expect(await screen.findByText(/Paid\. Your balance updates/)).toBeTruthy();
  });

  it('a declined card says so in our words', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.step === 'confirm') return new Response(JSON.stringify({ error: 'card_declined' }), { status: 402 });
      return new Response(JSON.stringify(body.step === 'start' ? START : credit), { status: 200 });
    }));
    wrap();
    fireEvent.click(await screen.findByTestId('card-pay-continue'));
    fireEvent.click(await screen.findByTestId('card-pay-confirm'));
    expect((await screen.findByRole('alert')).textContent).toBe('Your card was declined. Try another card or pay by e-transfer.');
  });
});
