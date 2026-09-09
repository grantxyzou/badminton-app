// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearFitSheet from '../../components/stats/GearFitSheet';
import { useGear, type UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';
import type { PlayerGear } from '../../lib/types';

/**
 * The fit questionnaire (spec `2026-09-07-racket-fit-design.md`, UI). Driven
 * through the REAL `useGear` hook, as `GearPickSheet.test.tsx` does, because
 * what these pin is that every answer is ONE write through the single owner —
 * the shape of the PATCH — and that a refused write is rendered, never dropped.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function gearDoc(extra: Partial<PlayerGear> = {}): PlayerGear {
  return { id: 'gear-1', memberId: 'm1', items: [], updatedAt: '2026-09-01', ...extra } as PlayerGear;
}

let calls: Array<{ url: string; init?: RequestInit }>;

function mockGear(doc: PlayerGear | null, opts: { patchStatus?: number; getStatus?: number } = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    if (!url.includes('/api/equipment/gear')) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    if (method === 'GET') {
      const status = opts.getStatus ?? 200;
      return Promise.resolve({ ok: status < 400, status, json: async () => ({ gear: doc }) } as Response);
    }
    const status = opts.patchStatus ?? 200;
    const body = JSON.parse(String(init?.body ?? '{}'));
    const { name: _n, ...prefs } = body;
    const patched = { ...(doc ?? gearDoc()), ...prefs };
    return Promise.resolve({ ok: status < 400, status, json: async () => ({ gear: patched }) } as Response);
  }) as unknown as typeof fetch);
}

function patches() {
  return calls
    .filter((c) => (c.init?.method ?? 'GET').toUpperCase() === 'PATCH')
    .map((c) => JSON.parse(String(c.init?.body)));
}

function Harness() {
  const gear: UseGear = useGear('Lin');
  return <GearFitSheet open onClose={vi.fn()} gear={gear} />;
}

function renderSheet() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

describe('GearFitSheet — every answer is one write through the single owner', () => {
  it('lights the saved answers and nothing else', async () => {
    mockGear(gearDoc({ fitGoal: 'more_power', fitSwing: 'fast', fitArmComfort: 'sometimes_sore', fitGrip: 'G5', stringBudgetMaxCad: 25 }));
    renderSheet();

    const fast = await screen.findByRole('tab', { name: 'Fast' });
    await waitFor(() => expect(fast.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tab', { name: 'Relaxed' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Sometimes sore' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'G5' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: '$15–25' }).getAttribute('aria-selected')).toBe('true');
    // The goal list marks its row with a check; the other four rows carry none.
    expect(screen.getByRole('button', { name: 'More power' }).querySelector('.material-icons')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'More control' }).querySelector('.material-icons')).toBeNull();
  });

  it('never lights "Not sure" or "No limit" for a member who has not answered — absent is absent', async () => {
    mockGear(gearDoc());
    renderSheet();
    const unsure = await screen.findByRole('tab', { name: 'Not sure' });
    expect(unsure.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'No limit' }).getAttribute('aria-selected')).toBe('false');
  });

  it('goal and swing can be cleared, as the privacy policy promises', async () => {
    mockGear(gearDoc({ fitGoal: 'faster', fitSwing: 'fast' }));
    renderSheet();
    const clears = await screen.findAllByRole('button', { name: 'Clear' });
    expect(clears).toHaveLength(2);
    fireEvent.click(clears[0]);
    await waitFor(() => expect(patches()).toEqual([{ name: 'Lin', fitGoal: null }]));
    // Every control is disabled while a write is in flight, so the second
    // clear waits for the first to land — the same way a member would.
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(patches()).toEqual([
      { name: 'Lin', fitGoal: null },
      { name: 'Lin', fitSwing: null },
    ]));
  });

  it('tapping the selected goal row clears it', async () => {
    mockGear(gearDoc({ fitGoal: 'more_control' }));
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'More control' }));
    await waitFor(() => expect(patches()).toEqual([{ name: 'Lin', fitGoal: null }]));
  });

  it('goal rows keep their card chrome while a write is in flight', async () => {
    // A never-resolving PATCH holds `busy` true.
    mockGear(gearDoc());
    const pending = new Promise<Response>(() => {});
    const real = global.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET').toUpperCase() === 'PATCH' ? pending : (real as typeof fetch)(input, init)));
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'More power' }));
    // Still buttons, not bare divs, and still labelled.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Fast' }).hasAttribute('disabled')).toBe(true));
    expect(screen.getByRole('button', { name: 'More control' }).className).toContain('cc-mini-card');
  });

  it('a redacted comfort answer lights nothing and says to sign in, rather than "not answered"', async () => {
    mockGear(gearDoc({ fitArmComfortRedacted: true } as Partial<PlayerGear>));
    renderSheet();
    expect(await screen.findByText(enMessages.stats.gear.fitArmRedacted)).toBeTruthy();
    for (const name of ['Fine', 'Sometimes sore', 'Often sore']) {
      expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('false');
    }
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('re-tapping the lit tab, or clearing what is already absent, sends no PATCH', async () => {
    mockGear(gearDoc({ fitSwing: 'fast' }));
    renderSheet();
    const fast = await screen.findByRole('tab', { name: 'Fast' });
    await waitFor(() => expect(fast.getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(fast);
    fireEvent.click(screen.getByRole('tab', { name: 'Not sure' }));
    fireEvent.click(screen.getByRole('tab', { name: 'No limit' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(patches()).toEqual([]);
  });

  it('offers "Nothing — happy with it" only when there is a racket to be happy with', async () => {
    mockGear(gearDoc());
    const { unmount } = renderSheet();
    await screen.findByText('What matters most in a racket?');
    expect(screen.queryByRole('button', { name: 'Nothing — happy with it' })).toBeNull();
    unmount();
    mockGear(gearDoc({ items: [{ id: 'i1', catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 88D Pro' }] }));
    renderSheet();
    expect(await screen.findByRole('button', { name: 'Nothing — happy with it' })).toBeTruthy();
  });

  it('asks the racket form of the question while the bag is UNKNOWN, not the no-racket form', async () => {
    mockGear(null, { getStatus: 500 });
    renderSheet();
    expect(await screen.findByText('What would you change about your racket?')).toBeTruthy();
  });

  it('goal rows are disabled, visibly, while a write is in flight', async () => {
    mockGear(gearDoc());
    const pending = new Promise<Response>(() => {});
    const real = global.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      (init?.method ?? 'GET').toUpperCase() === 'PATCH' ? pending : (real as typeof fetch)(input, init)));
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'More power' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'More control' }).hasAttribute('disabled')).toBe(true));
  });

  it('tapping a goal row PATCHes exactly that field, once', async () => {
    mockGear(gearDoc());
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Less arm fatigue' }));
    await waitFor(() => expect(patches()).toEqual([{ name: 'Lin', fitGoal: 'less_fatigue' }]));
    // And the row lights off the returned doc, with no refetch.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Less arm fatigue' }).querySelector('.material-icons')).not.toBeNull(),
    );
    expect(calls.filter((c) => (c.init?.method ?? 'GET') === 'GET')).toHaveLength(1);
  });

  it('the Clear link exists only once a comfort answer is stored, and clears with null', async () => {
    mockGear(gearDoc());
    renderSheet();
    await screen.findByRole('tab', { name: 'Often sore' });
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Often sore' }));
    const clear = await screen.findByRole('button', { name: 'Clear' });
    fireEvent.click(clear);
    await waitFor(() => expect(patches()).toEqual([
      { name: 'Lin', fitArmComfort: 'often_sore' },
      { name: 'Lin', fitArmComfort: null },
    ]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull());
  });

  it('"Not sure" clears the grip rather than storing a guess', async () => {
    mockGear(gearDoc({ fitGrip: 'G4' }));
    renderSheet();
    fireEvent.click(await screen.findByRole('tab', { name: 'Not sure' }));
    await waitFor(() => expect(patches()).toEqual([{ name: 'Lin', fitGrip: null }]));
  });

  it('asks the no-racket form of the goal question when the bag is empty, and the racket form otherwise', async () => {
    mockGear(gearDoc());
    const { unmount } = renderSheet();
    expect(await screen.findByText('What matters most in a racket?')).toBeTruthy();
    unmount();

    mockGear(gearDoc({ items: [{ id: 'i1', catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 88D Pro' }] }));
    renderSheet();
    expect(await screen.findByText('What would you change about your racket?')).toBeTruthy();
  });

  it('renders a lapsed session as "sign in again", not as a generic failure', async () => {
    mockGear(gearDoc(), { patchStatus: 401 });
    renderSheet();
    fireEvent.click(await screen.findByRole('tab', { name: 'Medium' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', enMessages.valueHub.bagSignInAgain);
  });

  it('with the gear read failed, lights nothing but keeps every control reachable', async () => {
    mockGear(null, { getStatus: 500 });
    renderSheet();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.length).toBeGreaterThan(0);
    for (const tab of tabs) expect(tab.getAttribute('aria-selected')).toBe('false');
    // The read-only format/budget line is omitted rather than written from fallbacks.
    expect(screen.queryByText(/Format and budget/)).toBeNull();
    // And the error is on screen.
    expect(screen.getByText(enMessages.stats.gear.kitError)).toBeTruthy();
  });
});
