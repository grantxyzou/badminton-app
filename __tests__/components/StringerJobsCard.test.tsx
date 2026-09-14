// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
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
