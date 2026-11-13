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
    // A style never switches the club's stringing: BPM's shop stays on.
    await waitFor(() => expect(patches()).toEqual([{ playersPerCourt: 8, money: 'off', membersFirst: { daysBefore: 5, time: '23:59' }, guests: 2, stringing: 'on' }]));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Members first/ }).getAttribute('aria-checked')).toBe('true'));
    expect(heard.at(-1)).toEqual({ style: 'members_first', playersPerCourt: 8, money: 'off', membersFirst: { daysBefore: 5, time: '23:59' }, guests: 2, stringing: 'on' });
    window.removeEventListener(CLUB_RUN_EVENT, listen);
  });

  it('changing one setting makes the club Custom', async () => {
    stored = { style: 'members_first', playersPerCourt: 8, money: 'off' };
    render(<ClubRunPage />);
    fireEvent.click(await screen.findByRole('radio', { name: '6 per court' }));
    await waitFor(() => expect(patches()).toEqual([{ playersPerCourt: 6, money: 'off', membersFirst: { daysBefore: 5, time: '23:59' }, guests: 2, stringing: 'off' }]));
    expect(await screen.findByText(/Custom: your rules below/)).toBeDefined();
  });

  it('turns the members-first window off, and moves its day, as one setting each', async () => {
    stored = { style: 'members_first', playersPerCourt: 8, money: 'off' };
    render(<ClubRunPage />);
    const day = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(day.value).toBe('5');
    fireEvent.change(day, { target: { value: '4' } });
    await waitFor(() => expect(patches().at(-1)).toEqual({ playersPerCourt: 8, money: 'off', membersFirst: { daysBefore: 4, time: '23:59' }, guests: 2, stringing: 'off' }));
    expect(await screen.findByText(/Custom: your rules below/)).toBeDefined();
    fireEvent.click(screen.getByRole('switch', { name: 'Members first' }));
    await waitFor(() => expect(patches().at(-1)).toEqual({ playersPerCourt: 8, money: 'off', membersFirst: null, guests: 2, stringing: 'off' }));
    expect(screen.getByText(/whoever signs up first gets the spot/)).toBeDefined();
  });

  it('turns guests on at one, and moves to two, as one setting', async () => {
    render(<ClubRunPage />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Members can bring guests' }));
    await waitFor(() => expect(patches().at(-1)).toMatchObject({ guests: 1 }));
    fireEvent.click(await screen.findByRole('radio', { name: '2 guests' }));
    await waitFor(() => expect(patches().at(-1)).toMatchObject({ guests: 2 }));
  });

  it('says a failed load in words, with no switches to tap', async () => {
    fetchMock.mockImplementation(async () => ok({}, 500));
    render(<ClubRunPage />);
    expect(await screen.findByText(/Couldn.t load the settings/)).toBeDefined();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  describe('the stringing add-on (docs/plans/stringing-add-on.md)', () => {
    beforeEach(() => { process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true'; });
    afterEach(() => { delete process.env.NEXT_PUBLIC_FLAG_STRINGING; });

    it('is on for BPM, and switches off as one setting without making the club Custom', async () => {
      render(<ClubRunPage />);
      const sw = await screen.findByRole('switch', { name: 'Stringing service' });
      expect(sw.getAttribute('aria-checked')).toBe('true');
      fireEvent.click(sw);
      await waitFor(() => expect(patches().at(-1)).toMatchObject({ stringing: 'off' }));
      expect(await screen.findByText(/no Stringing tab, bench or requests/)).toBeDefined();
      expect(screen.queryByText(/Custom: your rules below/)).toBeNull();
    });

    it('says why it cannot switch off while jobs are open, under the switch, and stays on', async () => {
      fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PATCH' ? ok({ error: 'stringing_open_jobs', open: 2 }, 409) : ok({ skipDates: [], lateCancelHours: null, run: stored }));
      render(<ClubRunPage />);
      fireEvent.click(await screen.findByRole('switch', { name: 'Stringing service' }));
      expect(await screen.findByText(/2 stringing jobs are still on the bench or unpaid/)).toBeDefined();
      await waitFor(() => expect(screen.getByRole('switch', { name: 'Stringing service' }).getAttribute('aria-checked')).toBe('true'));
    });

    it('is not offered with the deployment flag off, where it would change nothing', async () => {
      delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
      render(<ClubRunPage />);
      await screen.findByRole('switch', { name: 'Collect money in the app' });
      expect(screen.queryByRole('switch', { name: 'Stringing service' })).toBeNull();
    });
  });
});
