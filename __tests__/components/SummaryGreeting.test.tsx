// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SummaryGreeting from '../../components/stats/SummaryGreeting';
import enMessages from '../../messages/en.json';

/**
 * The A-section regression, end to end: `/api/stats/insight` is owner-or-admin
 * gated, and `useInsight` used to map every non-ok response to `null` — so a
 * 403 rendered exactly like "this member has no greeting".
 *
 * `useInsight` memoizes per lowercased name at module scope and only clears on
 * a name → different-name transition, so every case below signs in as a
 * DIFFERENT name. Reusing one would serve the previous case's cached result.
 */
function signIn(name: string) {
  localStorage.setItem('badminton_identity', JSON.stringify({ name, token: 't', sessionId: 's' }));
}

function mockInsight(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response),
    ) as unknown as typeof fetch,
  );
}

function renderGreeting() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SummaryGreeting />
    </NextIntlClientProvider>,
  );
}

const SIGN_IN_COPY = enMessages.stats.signInAgain;

describe('SummaryGreeting — a refusal is not an absent greeting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders the greeting when the read succeeds', async () => {
    signIn('GreetOk');
    mockInsight(200, { account: true, greeting: 'Your drops are landing.', level: null, trend: null });
    renderGreeting();
    await waitFor(() => expect(screen.getByText('Your drops are landing.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ── The distinction the fix exists for ──────────────────────────────────
  it('renders NOTHING when the read succeeds with no greeting (legitimate empty)', async () => {
    signIn('GreetEmpty');
    mockInsight(200, { account: false, greeting: null, level: null, trend: null });
    const { container } = renderGreeting();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the actionable sign-in state on a 403 (refused, not empty)', async () => {
    signIn('GreetForbidden');
    mockInsight(403, { error: 'forbidden' });
    renderGreeting();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(SIGN_IN_COPY);
  });

  it('does not keep telling a member to sign in AFTER they have signed in', async () => {
    // The module cache is keyed by name and only clears on a name → DIFFERENT
    // name transition, so a re-sign-in as the same name would replay the
    // refusal — an instruction the member has already followed.
    signIn('GreetRecovers');
    mockInsight(403, { error: 'forbidden' });
    renderGreeting();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    cleanup();

    mockInsight(200, { account: true, greeting: 'Welcome back.', level: null, trend: null });
    renderGreeting();
    await waitFor(() => expect(screen.getByText('Welcome back.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does NOT tell a rate-limited member to sign in — an unknown failure stays silent', async () => {
    signIn('GreetThrottled');
    mockInsight(429, { error: 'rate_limited' });
    const { container } = renderGreeting();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
