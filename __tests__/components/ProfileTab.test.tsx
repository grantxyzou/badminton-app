// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import enMessages from '../../messages/en.json';

const baseProps = {
  sessionId: 'session-2026-04-27',
  sessionLabel: 'Apr 27',
  isAdmin: false,
  onAdminTools: vi.fn(),
};

const renderWith = (props: Partial<typeof baseProps> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProfileTab {...baseProps} {...props} />
    </NextIntlClientProvider>,
  );

describe('ProfileTab', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('shows anonymous identity-only state: inline sign-in form + Create account + recovery code link', () => {
    renderWith();
    // Anonymous-state copy was refreshed in #91 — "Profile" was meaningless
    // for signed-out users and "invite only" read as gatekeeping.
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeDefined();
    expect(screen.getByText(/stats, kit and payment history/i)).toBeDefined();
    // Inline sign-in form (now shared via <SignInForm>) has a name input
    // (placeholder "Your name" from recovery.nameLabel) + PIN input + Sign in button.
    expect(screen.getByPlaceholderText('Your name')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
    // Create-an-account opens the action sheet
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeDefined();
    // Recovery-code path now reached via SignInForm's "Forgot your PIN?" link
    // (the standalone "Have a recovery code" link was removed in #93).
    expect(screen.getByText(/Forgot your PIN/i)).toBeDefined();
  });

  it('shows player profile + PIN row when identity exists', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
    );
    renderWith();
    expect(screen.getByText('Michael')).toBeDefined();
    // PIN management Settings row: until /api/members/me resolves the
    // hasPin status, the label falls back to the generic "Recovery PIN"
    // section title rather than asserting "New PIN" (which would mislead
    // users who DO have a PIN but the fetch errored). See Batch A H4.
    expect(screen.getByText(/Recovery PIN/i)).toBeDefined();
  });

  it('shows the sign-in methods card ONLY when signed in', async () => {
    // Regression: the card shipped inside the anonymous branch, so the members
    // it exists for never saw it and signed-out visitors got it duplicated
    // beneath the provider buttons. Its own tests render it directly, and these
    // tests rendered both states without ever asserting on it, so nothing
    // caught the misplacement.
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
    // URL-aware: ProfileTab also fetches /api/players and /api/members/me, and
    // answering those with the methods payload breaks its render.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        const body = u.includes('/api/auth/methods')
          ? { available: [], linked: [], hasPin: true, hasPassword: false, nudge: false }
          : u.includes('/api/players/unpaid')
            ? { totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] }
            : u.includes('/api/players')
              ? []
              : {};
        return Promise.resolve({ ok: true, json: async () => body } as unknown as Response);
      }),
    );

    // Anonymous: absent.
    renderWith();
    await Promise.resolve();
    expect(screen.queryByText('How you sign in')).toBeNull();
    cleanup();

    // Signed in: present.
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
    );
    renderWith();
    expect(await screen.findByText('How you sign in')).toBeDefined();

    delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
    vi.unstubAllGlobals();
  });

  it('shows admin tools button only when isAdmin', () => {
    renderWith({ isAdmin: false });
    expect(screen.queryByText(/Admin tools/i)).toBeNull();
    cleanup();
    renderWith({ isAdmin: true });
    expect(screen.getByText(/Admin tools/i)).toBeDefined();
  });

  it('does not show a session-signup CTA in anonymous state — Profile is identity-only', () => {
    renderWith();
    expect(screen.queryByText(/Sign up for this week/i)).toBeNull();
  });
});

/**
 * The anonymous sign-in card's ORDER and WEIGHT.
 *
 * The card used to read sign-in → or → Create an account → Continue with
 * Google, which put a second account-creation route above the one that already
 * creates accounts, and framed the divider as "sign in vs create" when both
 * halves do both. It also stacked three full-width pills.
 *
 * Two rules are pinned here, and only the first is about tidiness:
 *
 *  1. Providers lead when there are any — one tap, nothing to remember, and
 *     the only route that ends up holding a verified email.
 *  2. Weight is RELATIVE. "Create an account" drops to a link only when a
 *     provider button is above it competing. With no providers configured it is
 *     the only way to make an account from this screen, and keeps its button.
 *     Getting this wrong would ship a weaker create path to production, where
 *     the flag is currently off.
 */
describe('ProfileTab anonymous card order', () => {
  const flagBefore = process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;

  beforeEach(() => {
    localStorage.clear();
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (flagBefore === undefined) delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
    else process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = flagBefore;
  });

  /** Tappable controls inside the sign-in card, in document order. */
  function controls(container: HTMLElement): string[] {
    const card = container.querySelector('.glass-card');
    if (!card) throw new Error('sign-in card not rendered');
    return Array.from(card.querySelectorAll('a, button')).map((el) =>
      (el.textContent ?? '').trim(),
    );
  }

  it('puts Continue with Google above the PIN form', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={['google']} />
      </NextIntlClientProvider>,
    );
    const order = controls(container);
    const google = order.indexOf('Continue with Google');
    const signIn = order.indexOf('Sign in');
    expect(google).toBeGreaterThanOrEqual(0);
    expect(signIn).toBeGreaterThanOrEqual(0);
    expect(google).toBeLessThan(signIn);
  });

  it('never probes for availability when the server already resolved it', () => {
    // The whole reason the prop exists: probing would paint the card form-first
    // and then shove it down when the answer landed.
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={['google']} />
      </NextIntlClientProvider>,
    );
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.filter((c) => String(c[0]).includes('/api/auth/methods'))).toEqual([]);
  });

  it('demotes Create an account to a link ONLY when a provider competes with it', () => {
    const { container, unmount } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={['google']} />
      </NextIntlClientProvider>,
    );
    // Shorter label too: three full-sentence links do not fit across the card.
    const withProviders = screen.getByRole('button', { name: 'Create account' });
    expect(withProviders.className).toContain('link-quiet');
    expect(withProviders.className).not.toContain('btn-ghost');
    // And the divider separates one-tap from typing, so it sits above the form.
    const order = controls(container);
    expect(order.indexOf('Continue with Google')).toBeLessThan(order.indexOf('Sign in'));
    unmount();

    // No provider configured: nothing is competing, so the button stays a button.
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={[]} />
      </NextIntlClientProvider>,
    );
    const alone = screen.getByRole('button', { name: 'Create an account' });
    expect(alone.className).toContain('btn-ghost');
  });

  it('puts all three secondary links on one row, and only one of each', () => {
    // They used to sit on two rows: "Forgot your PIN?" is rendered BY the form,
    // the other two lived beneath it. Withholding the form's forgot callback is
    // what allows the row to own it — and the risk of that seam is rendering
    // the escape hatch TWICE, so the count is asserted, not just the position.
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={['google']} />
      </NextIntlClientProvider>,
    );
    const forgot = screen.getByRole('button', { name: 'Forgot PIN?' });
    const create = screen.getByRole('button', { name: 'Create account' });
    const useEmail = screen.getByRole('button', { name: 'Use email' });

    expect(create.parentElement).toBe(forgot.parentElement);
    expect(useEmail.parentElement).toBe(forgot.parentElement);
    // The form's own full-sentence version must not also be present.
    expect(screen.queryByRole('button', { name: /Forgot your PIN/i })).toBeNull();
  });

  it('keeps the form owning its forgot link when no provider competes', () => {
    // The row only exists when providers lead. With the flag off — production
    // today — the card must be exactly what it always was.
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={[]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Forgot your PIN/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Forgot PIN?' })).toBeNull();
  });

  it('renders no orphan divider when no provider is configured', () => {
    // A leading "or" with nothing above it. ProviderButtons renders null on an
    // empty/unknown answer, so a divider hard-coded above the form would strand.
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} authProviders={[]} />
      </NextIntlClientProvider>,
    );
    const order = controls(container);
    expect(order).not.toContain('Continue with Google');
    // Exactly one divider, and it is below the form, separating it from create.
    const dividers = container.querySelectorAll('.glass-card [aria-hidden="true"]');
    expect(dividers.length).toBe(1);
  });
});
