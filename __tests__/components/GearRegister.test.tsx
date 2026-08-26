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
    await screen.findByText('Items you own');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(gearReads().length).toBe(1);
  });
});

describe('GearRegister — D2, one tension number at a time', () => {
  function mountWith(tensionLbs: number | null) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/recommend') && u.includes('category=string')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            item: { id: 's1', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 5], attributes: {} },
            reasons: ['Wide usable tension window'],
            warnings: [],
            pairedWith: { label: 'Yonex Astrox 88D Pro', source: 'owned' },
            tensionLbs,
          }),
        });
      }
      if (u.includes('/api/stats/level')) {
        // StringTensionCard reads d.level.level, not d.level — with the wrong
        // shape it renders nothing and the "is it hidden" test below passes
        // for the wrong reason.
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: { level: 4 } }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) });
    }) as unknown as typeof fetch;

    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearRegister activeName="Lin" />
      </NextIntlClientProvider>,
    );
  }

  it('hides the level-based tension card once a pairing has given a real number', async () => {
    // The pair number is placed inside the racket-and-string overlap window;
    // the card's is round(21 + level). Both on screen is two answers to "what
    // should I tell my stringer".
    mountWith(25.5);
    await screen.findByText('Items you own');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByText('String tension')).toBeNull();
  });

  /**
   * The rail's refresh path skips PARKED categories, and `string` was parked on
   * every request until now — so it was half of each refetch pass and free.
   * Now it costs a call, against /api/recommend's 10/min/IP limit whose
   * throttled response is a bare {item: null} with a 200, which the rail's
   * ladder renders as an ERROR card. Two per pass is the budget; a feedback
   * loop through onPairTension -> setState -> re-render would blow it silently
   * and the only symptom would be a card that intermittently reads
   * "couldn't load".
   */
  it('costs exactly two recommend calls per mount, not a loop', async () => {
    mountWith(25.5);
    await screen.findByText('Items you own');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const recommendCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/api/recommend'));
    expect(recommendCalls.length).toBe(2);
  });

  it('keeps the level-based card when the pairing could not give one', async () => {
    // 11 of 71 frames publish no tension ceiling. Falling back is the whole
    // reason lib/tension.ts is not deleted.
    mountWith(null);
    await screen.findByText('Items you own');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.queryByText('String tension')).not.toBeNull());
  });
});
