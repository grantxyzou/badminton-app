// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import zhMessages from '@/messages/zh-CN.json';
import StringerJobsCard from '@/components/stringing/StringerJobsCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringerJobsCard hasIdentity />
    </NextIntlClientProvider>,
  );
}

describe('<StringerJobsCard /> states', () => {
  it('renders nothing when the server refuses — no session says nothing about stringing', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 401 }));
    const { container } = wrap();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a real failure shows the card with an alert and a Try again that asks again', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    wrap();
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your jobs.");
    const before = fetchSpy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
  });
});

const stringerJob = (status: string) => ({
  id: 'j1', jobNo: 'J-0003', memberId: 'm-akane', memberName: 'Akane', status,
  racketLabel: 'Arcsaber 11 Pro', stringLabel: 'Aerobite', tensionMains: 25, tensionCrosses: 27,
  method: '', readyBy: null, createdAt: '', updatedAt: '',
});

describe('the advance button speaks the status words, not the key', () => {
  // Audit 2026-10-11, finding 08: the label interpolated the raw status key,
  // so zh-CN rendered "标记为ready". The words come from the status table both
  // locales already carry.
  it('reads "Mark strung" for a received job', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    const expected = `Mark ${enMessages.admin.stringing.status.strung.toLowerCase()}`;
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
  });

  it('renders the Chinese status word in zh-CN, never the English key', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 }),
    );
    render(
      <NextIntlClientProvider locale="zh-CN" messages={zhMessages}>
        <StringerJobsCard hasIdentity />
      </NextIntlClientProvider>,
    );
    const expected = zhMessages.home.stringing.stringerAdvance.replace('{status}', zhMessages.admin.stringing.status.strung);
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
    expect(screen.queryByRole('button', { name: /strung/ })).toBeNull();
  });

  it('shows the ready-by date and how late it is — the stringer is the one who has to hit it', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [{ ...stringerJob('received'), readyBy: '2000-01-01' }], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    await screen.findByText('Arcsaber 11 Pro');
    // "N days late" from admin.stringing.due.overdue, the bench's own words.
    expect(screen.getByText(/days late$/)).toBeDefined();
  });

  it('offers Undo after an advance, and Undo puts the previous status back', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if (init?.method === 'PATCH') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ jobs: [stringerJob('received')], view: 'stringer' }), { status: 200 });
    });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark strung' }));
    const undo = await screen.findByRole('button', { name: enMessages.home.stringing.stringerUndo });
    fireEvent.click(undo);
    await waitFor(() => {
      const patches = fetchSpy.mock.calls.filter((c) => c[1]?.method === 'PATCH').map((c) => JSON.parse(String(c[1]?.body)));
      expect(patches).toEqual([
        { memberId: 'm-akane', status: 'strung' },
        { memberId: 'm-akane', status: 'received' },
      ]);
    });
    // Undone: the offer goes away until the next advance.
    await waitFor(() => expect(screen.queryByRole('button', { name: enMessages.home.stringing.stringerUndo })).toBeNull());
  });

  it('reads "Mark picked up" for a ready job', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('ready')], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    const expected = `Mark ${enMessages.admin.stringing.status.picked_up.toLowerCase()}`;
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
  });
});
