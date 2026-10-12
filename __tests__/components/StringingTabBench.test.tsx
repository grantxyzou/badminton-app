// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingTab from '../../components/StringingTab';
import enMessages from '../../messages/en.json';

/**
 * The admin's way onto the bench from the Stringing tab
 * (docs/plans/bench-redesign.md). A player sees the tab as it was and never
 * makes the bench read, which would 401 on every mount.
 */
const benchJobs = [
  { id: 'j1', stringerId: null, status: 'requested', readyBy: null, paidAt: null },
  { id: 'j2', stringerId: 'g', status: 'received', readyBy: '2026-01-02', paidAt: null },
];

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      urls.push(u);
      const body = u.includes('/stringing/jobs') ? { jobs: benchJobs } : u.includes('/shop') ? { open: true } : {};
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }),
  );
  return urls;
}

function wrap(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('the bench row on the Stringing tab', () => {
  it('shows an admin what is waiting and opens the bench in place', async () => {
    stubFetch();
    const onBench = vi.fn();
    wrap(<StringingTab isAdmin onBenchOpenChange={onBench} />);
    const row = await screen.findByRole('button', { name: /Stringing bench/ });
    expect(await screen.findByText('1 waiting · 1 late')).toBeDefined();
    fireEvent.click(row);
    expect(onBench).toHaveBeenCalledWith(true);
  });

  it('is not there for a player, who never asks for the bench', async () => {
    const urls = stubFetch();
    wrap(<StringingTab isAdmin={false} onBenchOpenChange={() => {}} />);
    await screen.findByText(enMessages.nav.stringing);
    expect(screen.queryByRole('button', { name: /Stringing bench/ })).toBeNull();
    expect(urls.some((u) => u.includes('/stringing/jobs'))).toBe(false);
  });
});
