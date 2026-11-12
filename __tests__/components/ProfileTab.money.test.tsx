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

function mockFetch(opts: { canGift: boolean; creditStatus?: number; owed?: number }) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/credit')) {
      return opts.creditStatus && opts.creditStatus !== 200
        ? new Response('{}', { status: opts.creditStatus })
        : new Response(JSON.stringify({ balanceCents: 1250, entries: [] }), { status: 200 });
    }
    if (url.includes('/api/players/unpaid')) {
      return new Response(JSON.stringify({ totalOwed: opts.owed ?? 0, sessions: [], stringing: [], payTo: null }), { status: 200 });
    }
    if (url.includes('/api/members/me/payments')) {
      return new Response(JSON.stringify({ months: [] }), { status: 200 });
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

async function renderSignedIn(waitForList = true) {
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 's' }));
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        <ProfileTab sessionId="s" sessionLabel="Apr 27" isAdmin={false} onAdminTools={vi.fn()} />
      </NextIntlClientProvider>,
    );
  });
  if (waitForList) await screen.findByText('Michael');
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
    const row = await screen.findByRole('button', { name: /^Credit\b.*\$12\.50/ });
    expect(screen.queryByRole('button', { name: /Give credit/ })).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { name: 'Credit' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Money')).toBeTruthy();
  });

  it('a gifter also gets Give a gift card, which opens its page', async () => {
    mockFetch({ canGift: true });
    await renderSignedIn();
    const give = await screen.findByRole('button', { name: /Give credit/ });
    await act(async () => {
      fireEvent.click(give);
    });
    expect(screen.getByRole('heading', { name: 'Give credit' })).toBeTruthy();
  });

  it('a failed credit read leaves the row without a figure, never $0', async () => {
    mockFetch({ canGift: false, creditStatus: 503 });
    await renderSignedIn();
    const row = screen.getByRole('button', { name: /^Credit\b/ });
    expect(row.textContent).not.toMatch(/\$/);
  });

  it('Account balance carries what is owed, in its own words, and opens its page', async () => {
    mockFetch({ canGift: false, owed: 22.5 });
    await renderSignedIn();
    const row = await screen.findByRole('button', { name: /Account balance.*\$22\.50 owed/ });
    await act(async () => {
      fireEvent.click(row);
    });
    expect(screen.getByRole('heading', { name: 'Account balance' })).toBeTruthy();
  });

  it('nothing owed: the row carries no figure', async () => {
    mockFetch({ canGift: false, owed: 0 });
    await renderSignedIn();
    const row = screen.getByRole('button', { name: /Account balance/ });
    expect(row.textContent).not.toMatch(/\$/);
  });

  it('with store credit off, Money holds Account balance alone', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
    mockFetch({ canGift: true });
    await renderSignedIn();
    expect(screen.getByText('Money')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Account balance/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Credit\b/ })).toBeNull();
  });

  it('Report a problem opens its page, and Back returns to Profile', async () => {
    mockFetch({ canGift: false });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: /Report a problem/ }));
    expect(screen.getByRole('heading', { name: 'Report a problem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Couldn’t sign up' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(await screen.findByText('Money')).toBeTruthy();
  });

  it('Support opens its page from Help, and Report a problem from there opens the report page', async () => {
    mockFetch({ canGift: false });
    await renderSignedIn();
    fireEvent.click(screen.getByRole('button', { name: /^Support/ }));
    expect(screen.getByRole('heading', { name: 'Support' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Report a problem/ }));
    expect(screen.getByRole('heading', { name: 'Report a problem' })).toBeTruthy();
  });

  it('Home’s “See details” lands on Account balance', async () => {
    mockFetch({ canGift: false });
    sessionStorage.setItem('badminton_profile_view', 'balance');
    await renderSignedIn(false);
    expect(await screen.findByRole('heading', { name: 'Account balance' })).toBeTruthy();
  });
});
