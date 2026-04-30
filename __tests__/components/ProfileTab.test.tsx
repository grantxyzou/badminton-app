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
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeDefined();
    expect(screen.getByText(/invite only/i)).toBeDefined();
    // Inline sign-in form has a name input + PIN input + Sign in button
    expect(screen.getByPlaceholderText('What is your name?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
    // Create-an-account opens the action sheet
    expect(screen.getByRole('button', { name: 'Create an account' })).toBeDefined();
    // Recovery-code fallback still present
    expect(screen.getByText(/Have a recovery code/i)).toBeDefined();
  });

  it('shows player profile + PIN row when identity exists', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
    );
    renderWith();
    expect(screen.getByText('Michael')).toBeDefined();
    // PIN management is now a Settings row labelled "New PIN" / "Update PIN"
    // depending on hasPin (defaults to false until /api/members/me resolves).
    expect(screen.getByText(/New PIN/i)).toBeDefined();
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
