// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function gearReads(): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/api/equipment/gear') && !u.includes('method'));
}

describe('GearRegister — single owner of the gear document', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((_url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) }),
    ) as unknown as typeof fetch;
  });

  /**
   * R10: the brief's original version asserted `toBe(1)` inside `waitFor`,
   * which passes the instant the count REACHES 1 — before any second reader
   * that fires in a LATER tick has had a chance to. That is not a hypothetical
   * shape: `GearPickRail` deliberately gates its own fetch on `gear.loaded`,
   * so a reintroduced gear reader copying the rail's pattern would be invisible
   * to the weak assertion. This test exists to prevent reintroduction, so it
   * has to survive the most likely form of it.
   *
   * The fix is to flush PAST the gear read settling — wait for a card that only
   * renders after `loaded` is true, then drain a macrotask boundary (microtasks
   * always resolve before a timer fires) — and only then count.
   */
  it('issues exactly ONE GET /api/equipment/gear per mount, including after the read settles', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearRegister activeName="Lin" />
      </NextIntlClientProvider>,
    );

    // The count is 1 as soon as the readers of the original bug would have run.
    await waitFor(() => expect(gearReads().length).toBe(1));

    // "Your kit" replaces its skeleton only once `loaded` flipped true, so
    // reaching it proves the gear read has settled and every effect keyed on
    // that has already been given the chance to fire.
    await screen.findByText('Your kit');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(gearReads().length).toBe(1);
  });
});
