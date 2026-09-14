// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import LockedCard, { PreviewRow, StatsSignInContext } from '../../components/stats/LockedCard';

/**
 * Grant, 2026-09-14: a Stats card this device may not fill keeps its shape
 * and carries its own Sign in. The banner that used to explain it is gone,
 * so the button on the card is the only way out.
 */
function renderCard(onSignIn: (() => void) | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatsSignInContext.Provider value={onSignIn}>
        <LockedCard icon="group" title="Who you play with" message="Sign in to see who you play with most.">
          <PreviewRow icon="person" />
        </LockedCard>
      </StatsSignInContext.Provider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe('LockedCard', () => {
  it('says what signing in shows, marks itself signed out, and its Sign in goes where the tab sends it', () => {
    const onSignIn = vi.fn();
    renderCard(onSignIn);
    expect(screen.getByText('Sign in to see who you play with most.')).toBeDefined();
    expect(screen.getByText(enMessages.stats.lockedPill)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: enMessages.stats.signIn }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the preview out of the accessibility tree — it is shape, not content', () => {
    const { container } = renderCard(vi.fn());
    expect(container.querySelector('.locked-preview')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers no button that goes nowhere when no tab provides a destination', () => {
    renderCard(null);
    expect(screen.queryByRole('button', { name: enMessages.stats.signIn })).toBeNull();
  });
});
