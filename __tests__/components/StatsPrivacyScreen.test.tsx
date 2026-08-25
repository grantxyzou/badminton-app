// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StatsPrivacyScreen from '../../components/StatsPrivacyScreen';
import { shouldPromptForComparison, type UseStatsPrivacy } from '../../lib/useStatsPrivacy';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

function state(over: Partial<UseStatsPrivacy> = {}): UseStatsPrivacy {
  return {
    privacy: { clubComparison: true, promptedAt: '2026-08-01T00:00:00.000Z' },
    loaded: true,
    error: false,
    saving: false,
    saveError: false,
    save: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    ...over,
  };
}

function renderScreen(s: UseStatsPrivacy = state(), onBack = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <StatsPrivacyScreen onBack={onBack} state={s} />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
  return { s, onBack };
}

describe('shouldPromptForComparison', () => {
  it('prompts a loaded member who has never been asked', () => {
    expect(
      shouldPromptForComparison(state({ privacy: { clubComparison: true, promptedAt: null } })),
    ).toBe(true);
  });

  it('does not prompt a member who already answered', () => {
    expect(shouldPromptForComparison(state())).toBe(false);
  });

  // ── Unknown is not known-false ──────────────────────────────────────────
  it('does not prompt while the read is still in flight', () => {
    expect(shouldPromptForComparison(state({ loaded: false, privacy: null }))).toBe(false);
  });

  it('does not prompt when the read FAILED', () => {
    // Asking again on every failed/rate-limited read would re-interrogate
    // someone who already answered.
    expect(shouldPromptForComparison(state({ error: true, privacy: null }))).toBe(false);
  });

  it('does not prompt when the server answered UNKNOWN (statsPrivacy: null)', () => {
    expect(shouldPromptForComparison(state({ privacy: null }))).toBe(false);
  });
});

describe('StatsPrivacyScreen', () => {
  afterEach(() => cleanup());

  it('renders the crumb and title', () => {
    renderScreen();
    expect(screen.getByText('Stats & privacy')).toBeTruthy();
    expect(screen.getByText('Profile')).toBeTruthy();
  });

  it('reflects the ON state in both the switch and the live line', () => {
    renderScreen();
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/you'll see your band on every compared skill/)).toBeTruthy();
  });

  it('reflects the OFF state', () => {
    renderScreen(state({ privacy: { clubComparison: false, promptedAt: '2026-08-01T00:00:00.000Z' } }));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/you'll still see the club spread/)).toBeTruthy();
  });

  it('saves the new value when toggled', () => {
    const { s } = renderScreen();
    fireEvent.click(screen.getByRole('switch'));
    expect(s.save).toHaveBeenCalledWith(false);
  });

  it('describes the switch with the live state line', () => {
    renderScreen();
    const described = screen.getByRole('switch').getAttribute('aria-describedby');
    expect(described).toBe('stats-privacy-state');
    expect(document.getElementById('stats-privacy-state')).toBeTruthy();
  });

  it('disables the switch while saving', () => {
    renderScreen(state({ saving: true }));
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces a save failure instead of silently reverting', () => {
    renderScreen(state({ saveError: true }));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  // ── Unknown ≠ a confirmed setting ───────────────────────────────────────
  // `useStatsPrivacy` documents `privacy === null` as UNKNOWN and reports it
  // with `loaded: true, error: false`. The screen used to apply `?? true` to
  // it and print a lit switch plus "you'll see your band on every compared
  // skill" — a privacy control stating a position nobody confirmed.
  it('draws NO switch when the read reported no preference', () => {
    renderScreen(state({ privacy: null, loaded: true, error: false }));
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(enMessages.stats.privacy.unknown);
    expect(screen.queryByText(/you'll see your band on every compared skill/)).toBeNull();
    expect(screen.queryByText(/you'll still see the club spread/)).toBeNull();
  });

  it('offers a re-read rather than a refresh for the unknown state', () => {
    const s = state({ privacy: null, loaded: true, error: false });
    renderScreen(s);
    fireEvent.click(screen.getByRole('button', { name: enMessages.stats.privacy.retry }));
    expect(s.reload).toHaveBeenCalled();
  });

  it('keeps a FAILED read distinct from an unknown one', () => {
    renderScreen(state({ privacy: null, loaded: true, error: true }));
    expect(screen.getByRole('alert').textContent).toBe(enMessages.stats.privacy.saveError);
    expect(screen.queryByText(enMessages.stats.privacy.unknown)).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('still draws the switch for a KNOWN stored preference', () => {
    renderScreen();
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.queryByText(enMessages.stats.privacy.unknown)).toBeNull();
  });

  it('goes back', () => {
    const { onBack } = renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /profile/i }));
    expect(onBack).toHaveBeenCalled();
  });

  // ── The "what others can see" table ─────────────────────────────────────
  it('says kudos are NEVER attributed — kudos stayed anonymous', () => {
    renderScreen();
    expect(screen.getByText('Kudos you send')).toBeTruthy();
    expect(screen.getByText(/never who sent it/)).toBeTruthy();
    // The handoff wanted "Always" here, which would have reversed the
    // strip-canary invariant in lib/kudos.ts. It was declined.
    expect(screen.queryByText('Always')).toBeNull();
  });

  it('lists ratings and level as never visible, and kit as counted only', () => {
    renderScreen();
    expect(screen.getAllByText('Never').length).toBe(3);
    expect(screen.getByText('Counted')).toBeTruthy();
    expect(screen.getByText(/a tally, never who/)).toBeTruthy();
  });

  it('closes with the note that opting out changes only what YOU see', () => {
    renderScreen();
    expect(screen.getByText(/nothing about your skills was ever shown to them/)).toBeTruthy();
    expect(screen.getByText(/The club spread stays visible either way/)).toBeTruthy();
  });
});
