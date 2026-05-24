// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../messages/en.json';
import RacketRecCard from '../components/profile/RacketRecCard';

function wrap(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

// Guards the CLAUDE.md "lying empty state is forbidden" rule for the Value-Hub
// rec card: while loading it renders nothing (not a confidently-empty card),
// and on a load failure it renders a distinct error pill (not silent zero).
describe('RacketRecCard legible-fail', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing while the recommendation is still loading', () => {
    // Never-resolving fetch keeps the component in its initial (item === null) state.
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const { container } = render(wrap(<RacketRecCard name="Lin" />));
    expect(container.firstChild).toBeNull();
  });

  it('renders an error pill on load failure — not a silent empty card', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    render(wrap(<RacketRecCard name="Lin" />));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load");
  });
});
