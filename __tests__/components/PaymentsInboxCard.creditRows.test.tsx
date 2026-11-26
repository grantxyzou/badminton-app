// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PaymentsInboxCard from '@/components/admin/CommandCenter/PaymentsInboxCard';
import type { EtransferPayment } from '@/lib/types';

/**
 * A credit review row (lib/creditReview.ts) in the inbox: it reads as credit,
 * its sheet offers "Return the credit" and "Keep it paid" and nothing else,
 * and Return sends the `return_credit` action.
 */
const originalFetch = global.fetch;
let sent: Array<Record<string, unknown>> = [];

const row = (): EtransferPayment => ({
  id: 'credit:p1:1700000000000',
  source: 'credit',
  credit: { kind: 'session', ref: 'p1', pk: 's1', memberId: 'm1', amountCents: 3000 },
  senderName: 'Lin',
  amountCents: 3000,
  memo: null,
  subject: 'Credit payment for session row p1',
  receivedAt: new Date().toISOString(),
  authenticated: true,
  status: 'review',
  reason: 'credit_untick',
  memberId: 'm1',
  payerName: 'Lin',
  allocations: [],
  createdAt: new Date().toISOString(),
});

function serve() {
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/admin/payments/assign')) {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (url.includes('/api/admin/payments')) {
      return new Response(JSON.stringify({
        configured: true, keyCreatedAt: null, lastReceivedAt: null, review: [row()], recent: [],
        last28Days: { received: 0, autoMatched: 0, adminMatched: 0, ignored: 0, waiting: 1 },
        hold: { threshold: 0, suggested: 2, names: [] },
        reminders: { on: false, lastRunAt: null, wouldRemind: [] },
        reconcile: null,
      }), { status: 200 });
    }
    if (url.includes('/api/members')) return new Response(JSON.stringify([{ name: 'Lin' }]), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('<PaymentsInboxCard /> — credit review rows', () => {
  beforeEach(() => {
    sent = [];
    serve();
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('lists "Credit · Lin" with the reason; the sheet offers Return and Keep only, and Return sends return_credit', async () => {
    render(<PaymentsInboxCard />);
    fireEvent.click(await screen.findByText('Credit · Lin'));
    expect(screen.getAllByText(/return the credit\?/i).length).toBeGreaterThan(0);
    const ret = await screen.findByRole('button', { name: 'Return $30.00 credit and un-tick' });
    expect(screen.getByRole('button', { name: 'Keep it paid — dismiss' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    expect(screen.queryByText('Who paid')).toBeNull();
    fireEvent.click(ret);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ paymentId: 'credit:p1:1700000000000', action: 'return_credit' });
  });
});
