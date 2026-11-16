// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import LedgerEntriesSheet from '@/components/admin/ledger/LedgerEntriesSheet';

/** The statement sheet: dated groups, what each entry is, reversals struck through, filters. */
const originalFetch = global.fetch;
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

const ENTRIES = [
  { id: 'payment:row-1', date: '2026-11-15T20:00:00Z', account: 'member_owed', kind: 'payment', reverses: null, amountCents: -1250, who: 'Lin', what: 'Nov 13 session', via: 'card', reason: null, reversed: false },
  { id: 'void:charge:job-6:0', date: '2026-11-14T20:00:00Z', account: 'member_owed', kind: 'void', reverses: 'charge', amountCents: -4000, who: 'Grant', what: 'Stringing · Astrox (job deleted)', via: null, reason: 'job_deleted', reversed: false },
  { id: 'charge:job-6:0', date: '2026-11-14T20:00:00Z', account: 'member_owed', kind: 'charge', reverses: null, amountCents: 4000, who: 'Grant', what: 'Stringing · Astrox (job deleted)', via: null, reason: null, reversed: true },
  { id: 'court:s', date: '2026-11-14T03:00:00Z', account: 'club_outlay', kind: 'court_cost', reverses: null, amountCents: 6000, who: 'Club', what: 'Courts · Nov 13 session', via: null, reason: null, reversed: false },
];

function serve(entries: unknown[], status = 200) {
  global.fetch = (async () => new Response(JSON.stringify({ range: '12w', entries, truncated: false }), { status })) as typeof fetch;
}

describe('LedgerEntriesSheet', () => {
  it('lists every entry by day, says what each is, strikes a reversal and what it reversed', async () => {
    serve(ENTRIES);
    render(<LedgerEntriesSheet open onClose={() => {}} range="12w" />);
    expect(await screen.findByText('Lin · Nov 13 session')).toBeTruthy();
    expect(screen.getByText('Payment · card')).toBeTruthy();
    expect(screen.getByText('Reversal of a charge (job deleted)')).toBeTruthy();
    expect(screen.getByText(/· reversed/)).toBeTruthy();
    expect(screen.getByText('−$12.50')).toBeTruthy();
    expect(screen.getByText('+$60.00')).toBeTruthy();
  });

  it('filters: club costs only, then reversals only', async () => {
    serve(ENTRIES);
    render(<LedgerEntriesSheet open onClose={() => {}} range="12w" />);
    await screen.findByText('Lin · Nov 13 session');
    fireEvent.click(screen.getByRole('button', { name: 'Club costs' }));
    expect(screen.getByText('Club · Courts · Nov 13 session')).toBeTruthy();
    expect(screen.queryByText('Lin · Nov 13 session')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reversals' }));
    expect(screen.getByText('Reversal of a charge (job deleted)')).toBeTruthy();
    expect(screen.queryByText('Club · Courts · Nov 13 session')).toBeNull();
  });

  it('a failed read says so, never an empty statement', async () => {
    serve([], 503);
    render(<LedgerEntriesSheet open onClose={() => {}} range="12w" />);
    expect(await screen.findByText("Couldn't load the entries.")).toBeTruthy();
  });
});
