// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, renderHook, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingPage from '../../components/admin/CommandCenter/StringingPage';
import { StringingAside, StringingAsideProvider } from '../../components/stringing/StringingAside';
import { usePaneMode, PANE_QUERY } from '../../lib/paneMode';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * Stringing on a foldable (docs/plans/foldable-layout.md; Grant, 2026-11-12:
 * "Option 2 but can we have something opened by default on the right?"). The
 * tab hands its registers a right-page element only in two-page mode; with it,
 * a tapped job opens THERE and the bench stays, and before any tap the job at
 * the top of the list is open. Without it — one screen — a tap is the job's
 * page, exactly as before. jsdom cannot see the layout (the canary pins the
 * CSS); this pins what renders where.
 */
const base: StringingJob = {
  id: 'job-1', memberId: 'member-kento', jobNo: 'J-0005', memberName: 'Kento',
  stringerId: null, stringerName: null, status: 'requested',
  racketLabel: 'Astrox 99 Pro', stringLabel: 'Exbolt 65', tensionMains: 26, tensionCrosses: 27,
  method: '', priceCents: null, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', history: [],
} as unknown as StringingJob;
const akane = { ...base, id: 'job-2', jobNo: 'J-0004', memberId: 'member-akane', memberName: 'Akane', racketLabel: 'Arcsaber 11 Pro', status: 'ready' } as StringingJob;

function respond(open: StringingJob[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: async () => {
        const u = String(url);
        if (u.includes('/shop')) return { open: true };
        if (u.includes('/strings')) return { strings: [] };
        if (u.includes('/stringers')) return { stringers: [] };
        if (u.includes('/members')) return [];
        return { jobs: u.includes('archived') ? [] : open, view: 'bench' };
      },
    } as Response),
  ));
}

function renderBench(slot: HTMLElement | null, onTakeover = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingAsideProvider value={slot}>
        <StringingPage embedded onBack={() => {}} onTakeover={onTakeover} />
      </StringingAsideProvider>
    </NextIntlClientProvider>,
  );
  return onTakeover;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('the bench on two pages', () => {
  it('opens the job at the top of the list on the right page before any tap', async () => {
    respond([base, akane]);
    const slot = document.body.appendChild(document.createElement('div'));
    renderBench(slot);
    await waitFor(() => expect(within(slot).getByRole('heading', { name: 'Kento' })).toBeDefined());
    // The bench is still there, and the open job's card says it is current.
    expect(screen.getByRole('region', { name: 'Stringing jobs' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Open this job · Astrox 99 Pro/ }).getAttribute('aria-current')).toBe('true');
    // No back bar on the right page: there is nothing to go back to.
    expect(within(slot).queryByRole('button', { name: /back/i })).toBeNull();
  });

  it('opens a tapped job beside the list, without taking the tab over', async () => {
    respond([base, akane]);
    const slot = document.body.appendChild(document.createElement('div'));
    const onTakeover = renderBench(slot);
    fireEvent.click(await screen.findByRole('button', { name: /Open this job · Arcsaber 11 Pro/ }));
    await waitFor(() => expect(within(slot).getByRole('heading', { name: 'Akane' })).toBeDefined());
    expect(within(slot).queryByRole('heading', { name: 'Kento' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Stringing jobs' })).toBeDefined();
    expect(onTakeover).not.toHaveBeenCalledWith(true);
  });

  it("opens the bench's own pages (Add job, the archive) on the right page too", async () => {
    respond([base, akane]);
    const slot = document.body.appendChild(document.createElement('div'));
    const onTakeover = renderBench(slot);
    fireEvent.click(await screen.findByRole('button', { name: 'Add job' }));
    await waitFor(() => expect(within(slot).getByRole('heading', { name: 'New job' })).toBeDefined());
    expect(screen.getByRole('region', { name: 'Stringing jobs' })).toBeDefined();
    // No job card reads as open while the right page holds something else.
    expect(document.querySelector('.bpm-job-card--open')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Archived/ }));
    await waitFor(() => expect(within(slot).getByRole('heading', { name: 'Archived' })).toBeDefined());
    // Tapping a job closes whatever was open and shows that job.
    fireEvent.click(screen.getByRole('button', { name: /Open this job · Arcsaber 11 Pro/ }));
    await waitFor(() => expect(within(slot).getByRole('heading', { name: 'Akane' })).toBeDefined());
    expect(onTakeover).not.toHaveBeenCalledWith(true);
  });

  it('on one screen a tap is still the job page, in place of the bench', async () => {
    respond([base, akane]);
    const onTakeover = renderBench(null);
    fireEvent.click(await screen.findByRole('button', { name: /Open this job · Arcsaber 11 Pro/ }));
    await waitFor(() => expect(onTakeover).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('region', { name: 'Stringing jobs' })).toBeNull();
    // Nothing is marked current where nothing stays open beside the list.
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });
});

describe('StringingAside', () => {
  it('renders into the right page when there is one, and nothing without', () => {
    const slot = document.body.appendChild(document.createElement('div'));
    const { rerender } = render(
      <StringingAsideProvider value={slot}>
        <StringingAside id="a"><p>open thing</p></StringingAside>
      </StringingAsideProvider>,
    );
    expect(within(slot).getByText('open thing')).toBeDefined();
    rerender(
      <StringingAsideProvider value={null}>
        <StringingAside id="a"><p>open thing</p></StringingAside>
      </StringingAsideProvider>,
    );
    expect(screen.queryByText('open thing')).toBeNull();
  });
});

describe('usePaneMode', () => {
  it('reads the shared pane query and follows its changes', () => {
    let matches = false;
    const listeners: (() => void)[] = [];
    const matchMedia = vi.fn(() => ({
      get matches() { return matches; },
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: () => {},
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const { result } = renderHook(() => usePaneMode());
    expect(matchMedia).toHaveBeenCalledWith(PANE_QUERY);
    expect(result.current).toBe(false);
    matches = true;
    act(() => listeners.forEach((cb) => cb()));
    expect(result.current).toBe(true);
  });
});
