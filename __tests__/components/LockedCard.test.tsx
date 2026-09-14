// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import enMessages from '../../messages/en.json';
import LockedCard, { PreviewRow, StatsSignInContext, useSignInLink } from '../../components/stats/LockedCard';

/**
 * Grant, 2026-09-14: a Stats card this device may not fill keeps its shape,
 * and the way in is the words "Sign in" in its sentence — not a button, not a
 * chip in the header (both were tried and were too loud down a whole tab).
 */
function Card() {
  const t = useTranslations('stats.partners');
  const signInLink = useSignInLink();
  return (
    <LockedCard icon="group" title="Who you play with" message={t.rich('locked', { link: signInLink })}>
      <PreviewRow icon="person" />
    </LockedCard>
  );
}

function renderCard(onSignIn: (() => void) | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatsSignInContext.Provider value={onSignIn}>
        <Card />
      </StatsSignInContext.Provider>
    </NextIntlClientProvider>,
  );
}

const SENTENCE = 'Sign in to see who you play with most.';

afterEach(() => cleanup());

describe('LockedCard', () => {
  it('reads as one sentence whose "Sign in" is the only control, and it goes where the tab sends it', () => {
    const onSignIn = vi.fn();
    const { container } = renderCard(onSignIn);
    expect(container.querySelector('p')?.textContent).toBe(SENTENCE);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Sign in');
    expect(buttons[0].className).toContain('locked-link');
    fireEvent.click(buttons[0]);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the preview out of the accessibility tree — it is shape, not content', () => {
    const { container } = renderCard(vi.fn());
    expect(container.querySelector('.state-preview')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('with nowhere to go, the words stay plain text — no link that goes nowhere', () => {
    const { container } = renderCard(null);
    expect(container.querySelector('p')?.textContent).toBe(SENTENCE);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
