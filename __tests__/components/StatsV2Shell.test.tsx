// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StatsV2Shell from '../../components/stats/StatsV2Shell';
import enMessages from '../../messages/en.json';

function renderShell(activeName: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatsV2Shell
        activeName={activeName}
        youSlot={<p>you-content</p>}
        playSlot={<p>play-content</p>}
        learnSlot={<p>learn-content</p>}
        gearSlot={<p>gear-content</p>}
      />
    </NextIntlClientProvider>,
  );
}

describe('StatsV2Shell', () => {
  beforeEach(() => {
    // The overview strip fetches on mount; resolve everything emptily so these
    // tests are about the shell, not the tiles.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response),
      ) as unknown as typeof fetch,
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('always renders exactly four registers', () => {
    renderShell();
    for (const label of ['You', 'Play', 'Learn', 'Gear']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    // v1 produced two- and three-tab variants depending on flags; v2 does not.
    const tabs = screen.getAllByRole('button').filter((b) =>
      ['You', 'Play', 'Learn', 'Gear'].includes(b.textContent ?? ''),
    );
    expect(tabs.length).toBe(4);
  });

  it('opens on You', () => {
    renderShell();
    expect(screen.getByText('you-content')).toBeTruthy();
    expect(screen.queryByText('play-content')).toBeNull();
  });

  it('marks the active register for assistive tech', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'You' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Play' }).getAttribute('aria-current')).toBeNull();
  });

  it('swaps content when a register is picked', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }));
    expect(screen.getByText('learn-content')).toBeTruthy();
    expect(screen.queryByText('you-content')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Gear' }));
    expect(screen.getByText('gear-content')).toBeTruthy();
    expect(screen.queryByText('learn-content')).toBeNull();
  });

  it('keeps the overview strip visible in every register', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByText('Level')).toBeTruthy());
    for (const label of ['Play', 'Learn', 'Gear']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByText('Level')).toBeTruthy();
      expect(screen.getByText('Games')).toBeTruthy();
      expect(screen.getByText('Kudos')).toBeTruthy();
    }
  });

  it('uses the v2 subhead, not the old joke', () => {
    renderShell();
    expect(screen.getByText('Where your game is, and what to do about it')).toBeTruthy();
    expect(screen.queryByText(/didn't ask for/)).toBeNull();
  });

  it('renders no attendance, streak or recent-form surface', () => {
    renderShell();
    const text = document.body.textContent ?? '';
    for (const banned of ['streak', 'Recent form', 'attended', 'of your last']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});
