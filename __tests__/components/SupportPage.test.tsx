// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import SupportPage from '@/components/profile/SupportPage';

/**
 * Support (spec §7): the guides (the organisers' one for admins only), three
 * common questions, Report a problem and contact, and the privacy pages.
 * A guide opens its public page under /legal/help.
 */
const realLocation = window.location;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, assign } });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

function renderPage(isAdmin = false) {
  const props = { isAdmin, onReport: vi.fn(), onBack: vi.fn() };
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SupportPage {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('SupportPage', () => {
  it('lists the guides for a player, without the organisers’ one', () => {
    renderPage(false);
    expect(screen.getByRole('heading', { name: 'Support' })).toBeTruthy();
    for (const title of ['Signing up for a session', 'Paying what you owe', 'Getting your racket strung', 'Your stats', 'The app and notifications']) {
      expect(screen.getByRole('button', { name: new RegExp(title) })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /For organisers/ })).toBeNull();
  });

  it('an admin also sees the organisers’ guide', () => {
    renderPage(true);
    expect(screen.getByRole('button', { name: /For organisers/ })).toBeTruthy();
  });

  it('a guide opens its public page', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Paying what you owe/ }));
    expect(assign).toHaveBeenCalledWith(expect.stringMatching(/\/legal\/help\/paying$/));
  });

  it('shows the three common questions with their answers', () => {
    renderPage();
    for (const qa of enMessages.profile.support.questions) {
      expect(screen.getByText(qa.q)).toBeTruthy();
      expect(screen.getByText(qa.a)).toBeTruthy();
    }
  });

  it('Report a problem hands back to Profile; contact and the privacy pages navigate', () => {
    const props = renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Report a problem/ }));
    expect(props.onReport).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Contact the people who run/ }));
    expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/\/legal\/support$/));
    fireEvent.click(screen.getByRole('button', { name: /Deleting your account/ }));
    expect(assign).toHaveBeenLastCalledWith(expect.stringMatching(/\/legal\/delete-account$/));
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(props.onBack).toHaveBeenCalledOnce();
    expect(within(document.body).getByText('Privacy policy')).toBeTruthy();
  });
});
