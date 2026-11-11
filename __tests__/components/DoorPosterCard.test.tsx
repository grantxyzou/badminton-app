// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import DoorPosterCard from '@/components/admin/CommandCenter/DoorPosterCard';

/** "A poster for everyone" on the Invite page (docs/plans/door-link.md). */
function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DoorPosterCard groupName="BPM Core" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DoorPosterCard', () => {
  it('with a club link, offers the poster', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ link: { token: 'a'.repeat(32), createdAt: '2026-11-05' }, unclaimed: 0 })));
    mount();
    expect(await screen.findByRole('button', { name: /Save poster/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy, share or replace the link' })).toBeDefined();
  });

  it('without one, makes it in one tap and then offers the poster', async () => {
    const fetchMock = vi.fn((_u: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ link: { token: 'b'.repeat(32), createdAt: '2026-11-05' } }, 201)
        : json({ link: null, unclaimed: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Make the club link' }));
    expect(await screen.findByRole('button', { name: /Save poster/ })).toBeDefined();
  });

  it('a failed read says so, with a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'read_failed' }, 503)));
    mount();
    expect(await screen.findByText(/Couldn't load the club link/)).toBeDefined();
  });
});
