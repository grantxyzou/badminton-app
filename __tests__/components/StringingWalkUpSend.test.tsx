// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingJobDetail from '../../components/admin/CommandCenter/StringingJobDetail';
import StringingReceiptSheet from '../../components/admin/CommandCenter/StringingReceiptSheet';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * The walk-up's job page (docs/plans/stringing-walk-ups.md, canvas frame "Job
 * page, walk-up", 2026-11-12): the "Send to {name}" card's states and the
 * receipt sheet. jsdom has no 2D canvas, so the context is a no-op stub and
 * the PNG a fixed data URL — the WORDS of the receipt are read off the
 * preview's alt text, which is built from the same input the canvas draws.
 */
const walkUp: StringingJob = {
  id: 'job-1',
  memberId: '~walkup:0123456789abcdef',
  walkUp: true,
  walkUpContact: 'lee@example.com',
  jobNo: 'J-0042',
  memberName: 'Lee',
  stringerId: 'member-grant',
  stringerName: 'Grant',
  status: 'received',
  racketLabel: 'Astrox 88D Pro',
  stringLabel: 'BG80',
  stringColor: 'Yellow',
  tensionMains: 26,
  tensionCrosses: 28,
  method: 'Zach',
  priceCents: 3400,
  readyBy: '2026-11-14',
  acceptedAt: null,
  paidAt: null,
  sessionId: null,
  createdAt: '2026-11-12T19:00:00.000Z',
  updatedAt: '2026-11-12T19:00:00.000Z',
  history: [{ status: 'received', at: '2026-11-12T19:00:00.000Z', by: 'member-grant' }],
  walkUpEmails: { spec: { at: '2026-11-12T19:00:05.000Z', ok: true } },
};

let fetchMock: ReturnType<typeof vi.fn>;

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}
const detail = (extra: Partial<StringingJob> = {}) =>
  wrap(<StringingJobDetail job={{ ...walkUp, ...extra }} onBack={() => {}} onChanged={() => {}} />);

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
  fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
  vi.stubGlobal('fetch', fetchMock);
  // A 2D context that draws nothing, and a canvas that exports a fixed PNG.
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, prop) => {
      if (prop in target) return target[prop as string];
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set: (target, prop, value) => {
      target[prop as string] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as { share?: unknown }).share;
  delete (window.navigator as { canShare?: unknown }).canShare;
});

describe('the "Send to {name}" card', () => {
  it('an email contact: emailed automatically, to the address, with the time it went', () => {
    detail();
    const card = screen.getByTestId('walkup-send-card');
    expect(within(card).getByText('Send to Lee')).toBeTruthy();
    expect(within(card).getByText(/An email address gets both emails on its own/)).toBeTruthy();
    expect(within(card).getByText('Emailed automatically')).toBeTruthy();
    expect(within(card).getByText(/To lee@example\.com/)).toBeTruthy();
    expect(within(card).getByTestId('walkup-email-sent').textContent).toMatch(/Sent /);
    expect(within(card).queryByText('Send again')).toBeNull();
    expect(within(card).getByText('Share the receipt')).toBeTruthy();
  });

  it('a failed spec email says "Not sent" and offers "Send again", which resends it', async () => {
    detail({ walkUpEmails: { spec: { at: '2026-11-12T19:00:05.000Z', ok: false } } });
    expect(screen.getByTestId('walkup-email-not-sent').textContent).toBe('Not sent');
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/stringing/jobs/job-1') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ job: { ...walkUp, walkUpEmails: { spec: { at: '2026-11-12T19:10:00.000Z', ok: true } } } }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(screen.getByTestId('walkup-email-sent')).toBeTruthy());
    const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({
      memberId: walkUp.memberId,
      resendSpecEmail: true,
    });
  });

  it('a spec email never sent (an older job) also offers "Send again"', () => {
    detail({ walkUpEmails: undefined });
    expect(screen.getByTestId('walkup-email-not-sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy();
  });

  it('a send in flight from another tap says "Sending…" and offers nothing (review, 2026-11-12)', () => {
    detail({ walkUpEmails: { spec: { at: new Date().toISOString(), ok: false, sending: true } } });
    expect(screen.getByTestId('walkup-email-sending').textContent).toBe(enMessages.admin.stringing.walkUp.sending);
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('a claim left from a send that never finished reads as not sent again', () => {
    detail({ walkUpEmails: { spec: { at: '2026-11-01T19:00:05.000Z', ok: false, sending: true } } });
    expect(screen.getByTestId('walkup-email-not-sent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send again' })).toBeTruthy();
  });

  it('a job that is over offers no "Send again"', () => {
    detail({ status: 'picked_up', walkUpEmails: { spec: { at: '2026-11-12T19:00:05.000Z', ok: false } } });
    expect(screen.getByTestId('walkup-email-not-sent')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('a refusal because it already went shows "Sent", not a failure', async () => {
    detail({ walkUpEmails: { spec: { at: '2026-11-12T19:00:05.000Z', ok: false } } });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/api/stringing/jobs/job-1') && init?.method === 'PATCH') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            error: 'already_sent',
            job: { ...walkUp, walkUpEmails: { spec: { at: '2026-11-12T19:10:00.000Z', ok: true } } },
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(screen.getByTestId('walkup-email-sent')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a phone number: no email row, and the hint says only the receipt applies', () => {
    detail({ walkUpContact: '604-555-0199', walkUpEmails: undefined });
    const card = screen.getByTestId('walkup-send-card');
    expect(within(card).queryByText('Emailed automatically')).toBeNull();
    expect(within(card).getByText(/no email address here, so share the receipt/)).toBeTruthy();
    expect(within(card).getByText('Share the receipt')).toBeTruthy();
  });

  it('a member\'s job has no such card', () => {
    detail({ walkUp: undefined, memberId: 'member-wei', walkUpContact: undefined, walkUpEmails: undefined });
    expect(screen.queryByTestId('walkup-send-card')).toBeNull();
  });

  it('"Share the receipt" opens the receipt sheet', async () => {
    detail();
    fireEvent.click(screen.getByText('Share the receipt'));
    expect(await screen.findByText('Receipt for Lee')).toBeTruthy();
  });
});

describe('the receipt sheet', () => {
  const sheet = (extra: Partial<StringingJob> = {}) =>
    wrap(<StringingReceiptSheet open onClose={() => {}} job={{ ...walkUp, ...extra }} />);

  it('draws the club, job, person, spec rows, total and how to pay — never the contact', async () => {
    sheet();
    const img = (await screen.findByRole('img')) as HTMLImageElement;
    const alt = img.alt;
    expect(alt).toContain('Stringing receipt');
    expect(alt).toContain('J-0042');
    expect(alt).toContain('For Lee');
    expect(alt).toContain('Racket: Astrox 88D Pro');
    expect(alt).toContain('String: BG80 · Yellow');
    expect(alt).toContain('Tension: 26 / 28 lb');
    expect(alt).toContain('Ready by: Sat, Nov 14');
    expect(alt).toContain('Dropped off: Thu, Nov 12');
    expect(alt).toContain('Total: $34');
    expect(alt).toContain('Pay at pickup, to your stringer. Bring this receipt or the job number.');
    expect(alt).not.toContain('lee@example.com');
  });

  it('an unpriced job totals "Ask"; a paid one says "Paid"', async () => {
    sheet({ priceCents: null });
    expect(((await screen.findByRole('img')) as HTMLImageElement).alt).toContain('Total: Ask');
    cleanup();
    sheet({ paidAt: '2026-11-13T00:00:00.000Z' });
    const alt = ((await screen.findByRole('img')) as HTMLImageElement).alt;
    expect(alt).toContain('\nPaid');
    expect(alt).not.toContain('Pay at pickup');
  });

  it('Share hands the image to navigator.share, marking the excursion first', async () => {
    let markedAtShare: string | null = null;
    const share = vi.fn(async () => {
      markedAtShare = window.localStorage.getItem('badminton_excursion_at');
    });
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true });
    sheet();
    const btn = await screen.findByRole('button', { name: 'Share' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files[0].name).toBe('receipt-J-0042.png');
    expect(markedAtShare).not.toBeNull();
  });

  it('Save image downloads the PNG (and marks the excursion)', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {});
    sheet();
    const btn = await screen.findByRole('button', { name: 'Save image' });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('receipt-J-0042.png');
    expect(window.localStorage.getItem('badminton_excursion_at')).not.toBeNull();
  });
});
