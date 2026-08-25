// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * The insight PRE-WARM on Home used to end in `.catch(() => {})`, which
 * swallowed the owner-gate 403 completely. It is the worst of the three
 * regression sites because nothing is rendered from it at all: a member whose
 * `member_session` cookie expired while `badminton_identity` persisted got no
 * signal anywhere — every owner-gated Stats read simply stopped having content.
 *
 * The tabs are stubbed. This test is about HomeShell's own banner decision,
 * and mounting the real tabs would drag their fetches (and their own failure
 * states) into a test that is not about them.
 */
vi.mock('@/components/HomeTab', () => ({ default: () => <div data-testid="home-tab" /> }));
vi.mock('@/components/PlayersTab', () => ({ default: () => null }));
vi.mock('@/components/SkillsTab', () => ({ default: () => null }));
vi.mock('@/components/ProfileTab', () => ({ default: () => null }));
vi.mock('@/components/BottomNav', () => ({ default: () => null }));
vi.mock('@/components/GlassPhysics', () => ({ default: () => null }));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/LanguageToggle', () => ({ default: () => null }));
vi.mock('@/components/PullToRefresh', () => ({ default: () => null }));

import HomeShell from '../../components/HomeShell';

function signIn(name: string) {
  localStorage.setItem('badminton_identity', JSON.stringify({ name, token: 't', sessionId: 's' }));
}

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

/** `insight` decides the 403; everything else answers benignly. */
function mockFetch(insight: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/stats/insight')) return insight();
      if (url.includes('/api/admin')) return json({ authed: false });
      if (url.includes('/api/members/me')) return json({ role: 'member' });
      if (url.includes('/api/session')) return json({ id: 's1', datetime: '2026-08-20T18:00:00-07:00' });
      return json({});
    }) as unknown as typeof fetch,
  );
}

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeShell initialAnnouncement={null} />
    </NextIntlClientProvider>,
  );
}

const BANNER_TITLE = enMessages.stats.signInAgainTitle;

describe('HomeShell — a swallowed 403 left the member with no signal at all', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('raises the sign-in banner when the owner-gated prewarm is refused', async () => {
    signIn('Lin');
    mockFetch(() => json({ error: 'forbidden' }, 403));
    renderShell();
    await waitFor(() => expect(screen.getByText(BANNER_TITLE)).toBeTruthy());
  });

  it('shows no banner when the prewarm succeeds', async () => {
    signIn('Lin');
    mockFetch(() => json({ account: true, greeting: 'hi', level: null, trend: null }));
    renderShell();
    await waitFor(() => expect(screen.getByTestId('home-tab')).toBeTruthy());
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });

  // Unknown ≠ known-false: a dropped request is the offline banner's business.
  it('shows no banner when the prewarm fails for network reasons', async () => {
    signIn('Lin');
    mockFetch(() => Promise.reject(new Error('network')));
    renderShell();
    await waitFor(() => expect(screen.getByTestId('home-tab')).toBeTruthy());
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });

  it('shows no banner for a signed-out visitor — there is no sign-in to have expired', async () => {
    mockFetch(() => json({ error: 'forbidden' }, 403));
    renderShell();
    await waitFor(() => expect(screen.getByTestId('home-tab')).toBeTruthy());
    expect(screen.queryByText(BANNER_TITLE)).toBeNull();
  });
});
