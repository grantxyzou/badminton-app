// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useCheckIn } from '@/components/stats/useCheckIn';

/**
 * Loading cascade, phase 3. Saving a check-in reloads the history. That
 * reload used to flip `status` to 'loading', which dropped SkillTrendCard and
 * WhereYouSitCard back to their skeletons right after the save they exist to
 * show. A reload of the SAME member now keeps 'ready' while it refreshes; a
 * different member still loads.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function history(n: number) {
  return { ok: true, status: 200, json: async () => ({ assessments: Array.from({ length: n }, (_, i) => ({ id: `a${i}` })) }) } as Response;
}

describe('useCheckIn reload', () => {
  it('keeps showing what it has while a same-member reload refreshes', async () => {
    let answer: (r: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(history(1))
      .mockImplementationOnce(() => new Promise<Response>((r) => { answer = r; }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCheckIn('Lin'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.reload());
    // Mid-refresh: still ready, still the old history.
    expect(result.current.status).toBe('ready');
    expect(result.current.snapshots).toHaveLength(1);

    await act(async () => answer(history(2)));
    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
  });

  it('a different member starts from loading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(history(1)).mockImplementation(() => new Promise(() => {})));
    const { result, rerender } = renderHook(({ name }) => useCheckIn(name), { initialProps: { name: 'Lin' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ name: 'Viktor' });
    expect(result.current.status).toBe('loading');
  });
});
