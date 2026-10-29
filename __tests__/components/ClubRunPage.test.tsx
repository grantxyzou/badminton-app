// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ClubRunPage from '@/components/admin/CommandCenter/ClubRunPage';
import { CLUB_RUN_EVENT } from '@/lib/useClubRun';
import { parseClubRun, type ClubRun } from '@/lib/clubRun';

/**
 * "How your club runs" (docs/plans/six-feathers-onboarding.md). A style fills
 * in the settings; a hand edit makes the club Custom. A failed load must never
 * render BPM's defaults as the club's answer — the next tap would overwrite it.
 */

let stored: unknown;
let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}
const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => (JSON.parse(String((init as RequestInit).body)) as { run: unknown }).run);

beforeEach(() => {
  stored = undefined;
  fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      // The route's own rule: the style is worked out from the values.
      stored = parseClubRun((JSON.parse(String(init.body)) as { run: unknown }).run);
      return ok({});
    }
    return ok({ skipDates: [], lateCancelHours: null, run: stored });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClubRunPage', () => {
  it('opens on BPM’s style for a club that has never chosen one', async () => {
    render(<ClubRunPage />);
    expect((await screen.findByRole('radio', { name: /First come, first served/ })).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Collect money in the app' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('switch', { name: 'Spots follow the courts' }).getAttribute('aria-checked')).toBe('false');
  });

  it('choosing a style saves all of its settings and tells the open screens', async () => {
    const heard: ClubRun[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent<ClubRun>).detail);
    window.addEventListener(CLUB_RUN_EVENT, listen);
    render(<ClubRunPage />);
    fireEvent.click(await screen.findByRole('radio', { name: /Members first/ }));
    await waitFor(() => expect(patches()).toEqual([{ playersPerCourt: 8, money: 'off' }]));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Members first/ }).getAttribute('aria-checked')).toBe('true'));
    expect(heard.at(-1)).toEqual({ style: 'members_first', playersPerCourt: 8, money: 'off' });
    window.removeEventListener(CLUB_RUN_EVENT, listen);
  });

  it('changing one setting makes the club Custom', async () => {
    stored = { style: 'members_first', playersPerCourt: 8, money: 'off' };
    render(<ClubRunPage />);
    fireEvent.click(await screen.findByRole('radio', { name: '6 per court' }));
    await waitFor(() => expect(patches()).toEqual([{ playersPerCourt: 6, money: 'off' }]));
    expect(await screen.findByText(/Custom: your settings below/)).toBeDefined();
  });

  it('says a failed load in words, with no switches to tap', async () => {
    fetchMock.mockImplementation(async () => ok({}, 500));
    render(<ClubRunPage />);
    expect(await screen.findByText(/Couldn.t load the settings/)).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
