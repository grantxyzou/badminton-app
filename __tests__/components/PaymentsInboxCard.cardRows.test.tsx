// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PaymentsInboxCard from '@/components/admin/CommandCenter/PaymentsInboxCard';
import type { EtransferPayment } from '@/lib/types';

/**
 * A card review row (lib/cardPay.ts `fileCardReview`) in the e-transfer inbox:
 * it reads as CARD money, never as an email; its sheet marks lines paid BY
 * CARD and offers no bank-name alias; a refund row can only be dismissed; and
 * the rows show even for a club that never set the Gmail script up.
 */
const originalFetch = global.fetch;

const base = (over: Partial<EtransferPayment>): EtransferPayment => ({
  id: 'card:cs_1',
  source: 'card',
  card: { checkoutId: 'cs_1', kind: 'payment' },
  senderName: 'Lin',
  amountCents: 9900,
  memo: null,
  subject: 'Stripe Checkout cs_1',
  receivedAt: new Date().toISOString(),
  authenticated: true,
  status: 'review',
  reason: 'card_amount_mismatch',
  memberId: 'm1',
  payerName: 'Lin',
  allocations: [],
  suggestions: [{ memberId: 'm1', name: 'Lin', owedCents: 0, proposed: [] }],
  createdAt: new Date().toISOString(),
  ...over,
});

function serve(review: EtransferPayment[], configured: boolean) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/admin/payments')) {
      return new Response(JSON.stringify({
        configured, keyCreatedAt: null, lastReceivedAt: null, review, recent: [],
        last28Days: { received: 0, autoMatched: 0, adminMatched: 0, ignored: 0, waiting: review.length },
        hold: { threshold: 0, suggested: 2, names: [] },
        reminders: { on: false, lastRunAt: null, wouldRemind: [] },
        reconcile: null,
      }), { status: 200 });
    }
    if (url.includes('/api/members')) return new Response(JSON.stringify([{ name: 'Lin' }]), { status: 200 });
    if (url.includes('/api/players/unpaid')) {
      return new Response(JSON.stringify({ sessions: [{ sessionId: 's1', playerId: 'p1', date: '2026-10-01T00:00:00Z', owedAmount: 12 }], stringing: [] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('<PaymentsInboxCard /> — card review rows', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('lists a card row as "Card · payer" with its reason, and its sheet marks paid BY CARD with no alias to remember', async () => {
    serve([base({})], true);
    render(<PaymentsInboxCard />);
    const rowBtn = await screen.findByText('Card · Lin');
    expect(screen.getByText(/doesn’t match the lines it was for/)).toBeTruthy();
    expect(screen.queryByText(/Unreadable email/)).toBeNull();

    fireEvent.click(rowBtn);
    await screen.findByRole('button', { name: 'Mark paid by card' });
    expect(screen.getByText(/Stripe has this money \(Checkout cs_1\)/)).toBeTruthy();
    expect(screen.queryByText(/Remember “/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Looked at it in Stripe — dismiss' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Not a session payment/ })).toBeNull();
  });

  it('a refund row offers dismiss only — no "who paid", no mark paid', async () => {
    serve([base({ id: 'card:cs_1:refund:ch_1', card: { checkoutId: 'cs_1', chargeId: 'ch_1', kind: 'refund' }, reason: 'card_refund_no_line', amountCents: 1000 })], true);
    render(<PaymentsInboxCard />);
    fireEvent.click(await screen.findByText('Card · Lin'));
    await screen.findByRole('button', { name: 'Looked at it in Stripe — dismiss' });
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    expect(screen.queryByText('Who paid')).toBeNull();
    expect(screen.getByText(/already went back to the card/)).toBeTruthy();
  });

  it('a dispute row says the bank pulled the money back and offers dismiss only', async () => {
    serve([base({ id: 'card:cs_1:dispute:dp_1', card: { checkoutId: 'cs_1', chargeId: 'ch_1', disputeId: 'dp_1', kind: 'dispute' }, reason: 'card_dispute', amountCents: 2700 })], true);
    render(<PaymentsInboxCard />);
    expect(await screen.findByText(/disputed by the bank/)).toBeTruthy();
    fireEvent.click(screen.getByText('Card · Lin'));
    await screen.findByRole('button', { name: 'Looked at it in Stripe — dismiss' });
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    expect(screen.getByText(/bank pulled this money back/)).toBeTruthy();
  });

  it('shows the card rows even when e-transfers are not set up, and the setup card when nothing waits', async () => {
    serve([base({})], false);
    const first = render(<PaymentsInboxCard />);
    await screen.findByText('Card · Lin');
    expect(screen.getByText(/E-transfers aren’t set up yet/)).toBeTruthy();
    expect(screen.queryByText('Auto-detect e-transfers')).toBeNull();
    first.unmount();

    serve([], false);
    render(<PaymentsInboxCard />);
    await screen.findByText('Auto-detect e-transfers');
  });
});
