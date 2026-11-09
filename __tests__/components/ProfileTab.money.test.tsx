// @vitest-environment jsdom
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '@/components/ProfileTab';
import enMessages from '@/messages/en.json';

/**
 * The MONEY group (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §1.5,
 * build step 4): Gift cards & credit for everyone while store credit is on,
 * Give a gift card only for a member marked `canGift`, each opening a page.
 */

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

function mockFetch(opts: { canGift: boolean; creditStatus?: number }) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/credit')) {
      return opts.creditStatus && opts.creditStatus !== 200
        ? new Response('{}', { status: opts.creditStatus })
        : new Response(JSON.stringify({ balanceCents: 1250, entries: [] }), { status: 200 });
    }
    if (url.includes('/api/giftcards')) {
      return new Response(JSON.stringify({ canGift: opts.canGift, cards: [] }), { status: 200 });
    }
    if (url.includes('/api/members/me')) {
      return new Response(JSON.stringify({ hasPin: true, createdAt: '2026-01-01' }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
}

async function renderSignedIn() {
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 's' }));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        <ProfileTab sessionId="s" sessionLabel="Apr 27" isAdmin={false} onAdminTools={vi.fn()} />
      </NextIntlClientProvider>,
    );
  });
  await screen.findByText('Michael');
}

describe('ProfileTab — MONEY', () => {
  beforeEach(() => {
    localStorage.clear();
    process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  it('shows the credit on the row and opens the Gift cards & credit page', async () => {
    mockFetch({ canGift: false });
    await renderSignedIn();
    expect(screen.getByText('Money')).toBeTruthy();
    const row = await screen.findByRole('button', { name: /Gift cards & credit.*\$12\.50/ });
    expect(screen.queryByRole('button', { name: /Give a gift card/ })).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { name: 'Gift cards & credit' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Money')).toBeTruthy();
  });

  it('a gifter also gets Give a gift card, which opens its page', async () => {
    mockFetch({ canGift: true });
    await renderSignedIn();
    const give = await screen.findByRole('button', { name: /Give a gift card/ });
    await act(async () => {
      fireEvent.click(give);
    });
    expect(screen.getByRole('heading', { name: 'Give a gift card' })).toBeTruthy();
  });

  it('a failed credit read leaves the row without a figure, never $0', async () => {
    mockFetch({ canGift: false, creditStatus: 503 });
    await renderSignedIn();
    const row = screen.getByRole('button', { name: /Gift cards & credit/ });
    expect(row.textContent).not.toMatch(/\$/);
  });

  it('the group is absent with store credit off', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
    mockFetch({ canGift: true });
    await renderSignedIn();
    expect(screen.queryByText('Money')).toBeNull();
    expect(screen.queryByRole('button', { name: /Gift cards & credit/ })).toBeNull();
  });
});
