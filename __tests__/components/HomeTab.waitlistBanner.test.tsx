// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';
import type { PushState, UsePushResult } from '@/lib/usePush';

/**
 * The waitlist banner (Grant, 2026-11-11, on the design canvas): who is
 * waiting and what happens next, with the position left to the big number
 * above it, and "Turn on notifications" offered right there while this phone
 * could still take a ping.
 */

const session = {
  id: 'session-2026-10-16',
  maxPlayers: 1,
  signupOpen: true,
  datetime: new Date(Date.now() + 48 * 3_600_000).toISOString(),
  deadline: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  locationName: 'Test Gym',
};

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

function push(state: PushState): UsePushResult {
  return { state, enable: async () => {}, disable: async () => {}, busy: false, error: null };
}

function renderHome(p: UsePushResult) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab memberName="Grant" push={p} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Grant', token: 'tok', sessionId: session.id }));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/kudos/eligible')) return ok({ eligible: [] });
    if (url.includes('/api/players')) {
      return ok([
        { id: 'p1', name: 'Lin', waitlisted: false },
        { id: 'p2', name: 'Grant', waitlisted: true },
      ]);
    }
    return ok([]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the waitlist banner', () => {
  it('says who is waiting and that the move is automatic, with no position line', async () => {
    renderHome(push({ status: 'off' }));
    expect(await screen.findByText(/Waitlisted as Grant\. You'll be moved up automatically\./)).toBeDefined();
    expect(screen.queryByText(/Position #/)).toBeNull();
  });

  it('offers "Turn on notifications" while push is off, and it opens the ping ask', async () => {
    renderHome(push({ status: 'off' }));
    fireEvent.click(await screen.findByRole('button', { name: enMessages.home.waitlistPing.turnOn }));
    expect(await screen.findByText(enMessages.home.waitlistPing.title)).toBeDefined();
  });

  it('offers nothing once push is on: the card says a ping will come instead', async () => {
    renderHome(push({ status: 'on' }));
    expect(await screen.findByText(enMessages.home.waitlistPing.willPing)).toBeDefined();
    expect(screen.queryByRole('button', { name: enMessages.home.waitlistPing.turnOn })).toBeNull();
  });

  it('offers nothing while push is still being checked: unknown is not off', async () => {
    renderHome(push({ status: 'loading' }));
    await screen.findByText(/Waitlisted as Grant/);
    expect(screen.queryByRole('button', { name: enMessages.home.waitlistPing.turnOn })).toBeNull();
  });
});
