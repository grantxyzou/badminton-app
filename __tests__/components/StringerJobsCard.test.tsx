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

  it('reads "Mark picked up" for a ready job', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jobs: [stringerJob('ready')], view: 'stringer' }), { status: 200 }),
    );
    wrap();
    const expected = `Mark ${enMessages.admin.stringing.status.picked_up.toLowerCase()}`;
    expect(await screen.findByRole('button', { name: expected })).toBeDefined();
  });
});
