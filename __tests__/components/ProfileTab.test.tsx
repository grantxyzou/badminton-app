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
    expect(screen.getByText(/Sign in with your name and PIN/i)).toBeDefined();
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
