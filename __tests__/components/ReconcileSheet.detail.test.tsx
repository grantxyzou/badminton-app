// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ReconcileSheet from '@/components/admin/ledger/ReconcileSheet';

/**
 * Grant, 2026-11-16: "Can we make the ledger check more descriptive, or more
 * detailed?" It said "Grant · stringing · Amounts differ" and told him to
 * settle a session again. Each line now names the job or session, says what
 * is wrong in a sentence, lists the ledger's own entries, and gives a fix for
 * that kind of line.
 */
const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

function serve(mismatches: unknown[]) {
  global.fetch = (async () =>
    new Response(JSON.stringify({ lastAt: new Date().toISOString(), checked: 13, mismatches }), { status: 200 })) as typeof fetch;
}

const LONE_PAYMENT = {
  memberId: 'm-grant',
  name: 'Grant',
  ref: { kind: 'stringing', id: 'job-6', pk: 'm-grant' },
  code: 'amount_mismatch',
  ledgerCents: -4000,
  liveCents: 0,
  detail: {
    subject: { kind: 'stringing', exists: true, jobNo: 'J-0006', racket: 'Astrox 88D Pro', status: 'ready', paidAt: '2026-11-16T02:00:00Z', invoiced: false, billsOnInvoice: true, archived: true, withdrawn: false },
    entries: [{ kind: 'payment', amountCents: -4000, note: 'Card', at: '2026-11-16T02:00:00Z', via: 'card', reason: null, voided: false }],
  },
};

describe('ReconcileSheet — what each line says', () => {
  it('a stringing job with a lone payment: the job, where it stands, why, its entries, and a job fix', async () => {
    serve([LONE_PAYMENT]);
    render(<ReconcileSheet open onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Grant · J-0006 · Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText(/Ready · paid .* · not invoiced · archived/)).toBeTruthy();
    expect(screen.getByText(/has a \$40\.00 payment but no charge under it/)).toBeTruthy();
    expect(screen.getByTestId('reconcile-entries').textContent).toMatch(/Payment \(card\)−\$40\.00/);
    expect(screen.getByText(/Open J-0006 on the bench \(in the archive\)/)).toBeTruthy();
    // Never the session advice for a stringing line.
    expect(screen.queryByText(/settle it again/)).toBeNull();
    expect(screen.queryByRole('button', { name: /session’s payments/ })).toBeNull();
  });

  it('a deleted, paid job offers "Restore the charge", and the check runs again after it', async () => {
    const deleted = { ...LONE_PAYMENT, detail: { subject: { kind: 'stringing', exists: false }, entries: LONE_PAYMENT.detail.entries } };
    const calls: Array<[string, string | undefined, string | undefined]> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init?.method, init?.body ? String(init.body) : undefined]);
      if (String(input).endsWith('/api/admin/ledger/repair')) return new Response(JSON.stringify({ outcome: 'restored', amountCents: 4000 }), { status: 200 });
      if (init?.method === 'POST') return new Response(JSON.stringify({ lastAt: new Date().toISOString(), checked: 13, mismatches: [] }), { status: 200 });
      return new Response(JSON.stringify({ lastAt: new Date().toISOString(), checked: 13, mismatches: [deleted] }), { status: 200 });
    }) as typeof fetch;
    const onChanged = vi.fn();
    render(<ReconcileSheet open onClose={() => {}} onChanged={onChanged} />);
    expect(await screen.findByText('Grant · stringing job (deleted)')).toBeTruthy();
    expect(screen.getByText(/deleted after it was paid/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore the $40.00 charge' }));
    expect(await screen.findByText('The ledger matches what everyone sees.')).toBeTruthy();
    const posted = calls.find(([u]) => u.endsWith('/api/admin/ledger/repair'))!;
    expect(JSON.parse(posted[2]!)).toEqual({ kind: 'stringing', id: 'job-6', memberId: 'm-grant' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('a job that still exists gets no restore button', async () => {
    serve([LONE_PAYMENT]);
    render(<ReconcileSheet open onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Grant · J-0006 · Astrox 88D Pro');
    expect(screen.queryByTestId('reconcile-restore')).toBeNull();
  });

  it('a session line names the night and opens its payments', async () => {
    serve([
      {
        memberId: 'm-lin', name: 'Lin', ref: { kind: 'session', id: 'row-1', pk: 'session-2026-11-13' }, code: 'missing_payment', ledgerCents: 1250, liveCents: 0,
        detail: {
          subject: { kind: 'session', exists: true, date: '2026-11-13', paid: true, paidVia: 'etransfer', covered: false, removed: false, settled: true },
          entries: [{ kind: 'charge', amountCents: 1250, note: 'Session', at: '2026-11-14T06:00:00Z', via: null, reason: null, voided: false }],
        },
      },
    ]);
    const onOpenSession = vi.fn();
    const onClose = vi.fn();
    render(<ReconcileSheet open onClose={onClose} onChanged={() => {}} onOpenSession={onOpenSession} />);
    expect(await screen.findByText('Lin · Nov 13 session')).toBeTruthy();
    expect(screen.getByText(/Settled · paid \(e-transfer\)/)).toBeTruthy();
    expect(screen.getByText(/mark the row unpaid, then paid again/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open this session’s payments' }));
    expect(onClose).toHaveBeenCalled();
    expect(onOpenSession).toHaveBeenCalledWith('session-2026-11-13');
  });

  it('a line from an older server (no detail) still reads', async () => {
    const { detail: _d, ...bare } = LONE_PAYMENT;
    serve([bare]);
    render(<ReconcileSheet open onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('Amounts differ')).toBeTruthy();
    expect(screen.getByText(/In the ledger/)).toBeTruthy();
  });
});
