// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../messages/en.json';
import RacketRecCard from '../components/stats/cards/RacketRecCard';

function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

// Guards the CLAUDE.md "lying empty state is forbidden" rule for the Value-Hub
// rec card: while loading it shows the card frame but neither a fake pick nor
// an error; on a load failure it shows a distinct error pill (not silent zero).
describe('RacketRecCard legible-fail', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('while loading, shows the card title but no recommendation or error', () => {
    // Never-resolving fetch keeps the component in its initial (loaded === false) state.
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    render(wrap(<RacketRecCard name="Lin" />));
    expect(screen.getByText('We recommend')).toBeTruthy();
    // No fake recommendation and no error while still loading.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an error pill on load failure — not a silent empty card', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    render(wrap(<RacketRecCard name="Lin" />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load");
  });
});
