// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingInvoiceCard from '../../components/stringing/StringingInvoiceCard';
import enMessages from '../../messages/en.json';
import { invoiceView, withInvoiceSent } from '../../lib/stringingInvoiceView';
import type { StringingJob } from '../../lib/types';

/**
 * The invoice card (docs/plans/stringing-invoice.md): what it says before and
 * after a send, the sheet that is the last look at the figure, and the
 * picture opening at once when nothing reached the person.
 */
function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
      {node}
    </NextIntlClientProvider>,
  );
}

const job = {
  id: 'job-1', memberId: 'member-wei', memberName: 'Wei', jobNo: 'J-0006',
  stringerId: null, stringerName: null, status: 'ready',
  racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 26,
  method: '', priceCents: 2600, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
  createdAt: '2026-11-13T02:00:00.000Z', updatedAt: '2026-11-13T02:00:00.000Z',
  history: [{ status: 'ready', at: '2026-11-13T02:00:00.000Z', by: null }],
  billOn: 'invoice',
} as StringingJob;

function stub(delivered: { push: number; email: boolean; reached: boolean }) {
  const sent = withInvoiceSent(job, new Date().toISOString(), 'member-org');
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ invoice: invoiceView(sent), delivered, job: sent }),
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StringingInvoiceCard', () => {
  it('before a send: the number, the amount, and that nothing is owed yet', () => {
    wrap(<StringingInvoiceCard job={job} view={invoiceView(job)} receiptJob={job} onSent={() => {}} />);
    expect(screen.getByText('Invoice INV-0006')).toBeDefined();
    expect(screen.getByTestId('invoice-amount').textContent).toBe('$26');
    expect(screen.getByText(/Wei owes nothing until you send it/)).toBeDefined();
    expect(screen.getByTestId('invoice-send').textContent).toBe('Send invoice');
  });

  it('sends from the sheet, with the partition key, and says who heard', async () => {
    const fetchMock = stub({ push: 1, email: false, reached: true });
    const onSent = vi.fn();
    wrap(<StringingInvoiceCard job={job} view={invoiceView(job)} receiptJob={job} onSent={onSent} />);
    fireEvent.click(screen.getByTestId('invoice-send'));
    fireEvent.click(await screen.findByTestId('invoice-confirm'));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/stringing\/jobs\/job-1\/invoice$/);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ memberId: 'member-wei' });
    expect((await screen.findByTestId('invoice-outcome')).textContent).toBe('Sent. Wei got a notification.');
  });

  it('nobody reached: says so and opens the picture to share', async () => {
    stub({ push: 0, email: false, reached: false });
    wrap(<StringingInvoiceCard job={job} view={invoiceView(job)} receiptJob={job} onSent={() => {}} />);
    fireEvent.click(screen.getByTestId('invoice-send'));
    fireEvent.click(await screen.findByTestId('invoice-confirm'));
    expect((await screen.findByTestId('invoice-outcome')).textContent).toMatch(/no notifications or email on file/);
    expect(await screen.findByText('Invoice for Wei')).toBeDefined();
  });

  it('after a send: when it went, and a resend; a price change since is called out', () => {
    const sent = withInvoiceSent(job, '2026-11-14T03:00:00.000Z', 'member-org');
    const moved = { ...sent, priceCents: 2800 };
    wrap(<StringingInvoiceCard job={moved} view={invoiceView(moved)} receiptJob={moved} onSent={() => {}} />);
    expect(screen.getByText(/^Sent /)).toBeDefined();
    expect(screen.getByTestId('invoice-send').textContent).toBe('Send again');
    expect(screen.getByTestId('invoice-price-changed').textContent).toContain('$26 → $28');
  });

  it('a refusal reads as our sentence, never the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'job_paid' }) } as Response));
    wrap(<StringingInvoiceCard job={job} view={invoiceView(job)} receiptJob={job} onSent={() => {}} />);
    fireEvent.click(screen.getByTestId('invoice-send'));
    fireEvent.click(await screen.findByTestId('invoice-confirm'));
    expect((await screen.findByRole('alert')).textContent).toBe('This restring is already paid.');
  });
});
