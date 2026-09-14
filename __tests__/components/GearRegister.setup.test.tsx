// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * NEXT_PUBLIC_FLAG_GEAR_SETUP on: the register is the Set-up card, and every
 * reader still has exactly one instance. The card, the tension card and the
 * club card all show facts about the same bag and the same tally — a second
 * reader of either is two chances to disagree on one screen.
 */
function calls(match: (u: string) => boolean): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter(match);
}

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearRegister activeName="Lin" />
    </NextIntlClientProvider>,
  );
}

describe('GearRegister — flag on: the Set-up card', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP = 'true';
    resetCatalogCache();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [], item: null, needsCheckIn: true }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the card, and no rail or kit list', async () => {
    mount();
    expect(await screen.findByText('Set-up')).toBeTruthy();
    expect(screen.queryByText('Your equipment')).toBeNull();
  });

  it('one gear read, one tally read, one recommend read per sourced category', async () => {
    mount();
    await screen.findByText('Set-up');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(calls((u) => u.includes('/api/recommend')).length).toBe(2));
    expect(calls((u) => u.includes('/api/equipment/gear')).length).toBe(1);
    expect(calls((u) => u.includes('/api/stats/club/gear')).length).toBe(1);
  });
});

describe('GearRegister — flag off: unchanged', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders the kit card and not the Set-up card', async () => {
    mount();
    expect(await screen.findByText('Your equipment')).toBeTruthy();
    expect(screen.queryByText('Set-up')).toBeNull();
  });
});
