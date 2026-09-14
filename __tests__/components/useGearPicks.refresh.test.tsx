// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { useGearPicks } from '../../components/stats/useGearPicks';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

/**
 * `refresh` exists for the Set-up register: when the racket in play changes,
 * the string pairing (made against that racket) is re-asked — and ONLY the
 * string. The racket pick must not re-score on a bag change (see `recKey`).
 */
function recommendCalls(cat: string): number {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/api/recommend') && u.includes(`category=${cat}`)).length;
}

const gear = { gear: null, loaded: true, loadError: false } as unknown as UseGear;
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{children}</NextIntlClientProvider>
);

describe('useGearPicks — refresh', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, needsCheckIn: true }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('re-asks exactly the category named, once', async () => {
    const { result } = renderHook(() => useGearPicks('Lin', gear), { wrapper });
    await waitFor(() => expect(result.current.view.string.status).toBe('parked'));
    expect(recommendCalls('string')).toBe(1);
    expect(recommendCalls('racket')).toBe(1);

    act(() => result.current.refresh('string'));
    await waitFor(() => expect(recommendCalls('string')).toBe(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(recommendCalls('racket')).toBe(1);
    expect(recommendCalls('string')).toBe(2);
  });

  it('ignores a category with no engine', async () => {
    const { result } = renderHook(() => useGearPicks('Lin', gear), { wrapper });
    await waitFor(() => expect(recommendCalls('string')).toBe(1));
    act(() => result.current.refresh('shoe'));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(recommendCalls('shoe')).toBe(0);
  });
});
