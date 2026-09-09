// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickRail, { REC_REFETCH_DEBOUNCE_MS } from '../../components/stats/GearPickRail';
import { PROFILE_READS_FIT } from '../../lib/racketProfile';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

/**
 * Until an engine reads the fit answers, a fit change must NOT re-ask
 * `/api/recommend`: the answer cannot differ, and a member answering the
 * questionnaire at reading pace was ten calls into a 10/min limit whose
 * throttled 200 renders both cards as errors. The gate is `PROFILE_READS_FIT`
 * next to `buildProfile`, so the day a field is read the rail follows.
 */
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const ITEM = { id: 'r1', category: 'racket' as const, brand: 'Yonex', model: 'Astrox 99 Pro', skillRange: [3, 6] as [number, number], attributes: {} };

function fakeGear(gear: object): UseGear {
  return {
    gear: gear as UseGear['gear'], rackets: [], active: null, loaded: true, loadError: false, busy: false, online: true,
    reload: vi.fn(), add: vi.fn(async () => ({ ok: true as const })), addCustom: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })), remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })), setTension: vi.fn(async () => ({ ok: true as const })),
  };
}
const ui = (gear: UseGear) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <GearPickRail activeName="Lin" gear={gear} />
  </NextIntlClientProvider>
);
const doc = (extra: object) => ({ id: 'g', memberId: 'm', updatedAt: '2026-01-01', items: [], ...extra });

describe('GearPickRail — the fit refetch is gated on an engine reading the answers', () => {
  it('the gate is still closed (flip it in lib/racketProfile.ts when Phase 2 lands, and delete this assertion)', () => {
    expect(PROFILE_READS_FIT).toBe(false);
  });

  it('with the gate closed, a fit or string-budget change re-asks nothing', async () => {
    const asks: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      asks.push(String(input));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;
    const { rerender } = render(ui(fakeGear(doc({}))));
    await screen.findByLabelText('Racket — Why this?');
    expect(asks).toHaveLength(2);
    vi.useFakeTimers();
    rerender(ui(fakeGear(doc({ fitGoal: 'more_power', fitSwing: 'fast', stringBudgetMaxCad: 25 }))));
    await act(async () => { await vi.advanceTimersByTimeAsync(REC_REFETCH_DEBOUNCE_MS * 2); });
    expect(asks).toHaveLength(2);
    // Format and budget are read today, and still re-ask at once.
    rerender(ui(fakeGear(doc({ fitGoal: 'more_power', budgetMaxCad: 200 }))));
    await act(async () => {});
    expect(asks).toHaveLength(4);
  });
});
