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

  it('shows anonymous empty state when no identity', () => {
    renderWith();
    expect(screen.getByText(/Set up your profile/i)).toBeDefined();
    expect(screen.getByText(/Already a player\? Sign in/i)).toBeDefined();
  });

  it('shows player profile + PIN row when identity exists', () => {
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
    );
    renderWith();
    expect(screen.getByText('Michael')).toBeDefined();
    expect(screen.getByText(/Recovery PIN/i)).toBeDefined();
  });

  it('shows admin tools button only when isAdmin', () => {
    renderWith({ isAdmin: false });
    expect(screen.queryByText(/Admin tools/i)).toBeNull();
    cleanup();
    renderWith({ isAdmin: true });
    expect(screen.getByText(/Admin tools/i)).toBeDefined();
  });

  it('renders the Sign-up CTA in anonymous state when onTabChange is provided', () => {
    const onTabChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} onTabChange={onTabChange} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Sign up for this week/i)).toBeDefined();
  });
});
