// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';
import { saveHomeSnapshot, homeSnapshotKey, readHomeSnapshot, HOME_SNAPSHOT_MAX_AGE_MS } from '@/lib/homeSnapshot';
import { clearDeviceTraces } from '@/lib/clearDeviceTraces';
import { resetSharedReads } from '@/lib/sharedRead';

/**
 * Grant, 2026-11-05: slow "waiting on loading placeholder". Home draws last
 * time's week at once, marked as updating with its buttons held, and the
 * server's answer replaces it; a failed refresh shows the error instead.
 */
const SESSION = {
  id: 'session-2026-11-12',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  locationName: 'Copied Gym',
};
const FRESH = { ...SESSION, locationName: 'Fresh Gym' };
const KEY = homeSnapshotKey('bpm', 'Lin');

beforeEach(() => {
  localStorage.clear();
  resetSharedReads();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
      <HomeTab memberName="Lin" groupId="bpm" />
    </NextIntlClientProvider>,
  );
}

/** Every read waits for `release`, so the copy is on screen alone until then. */
function heldFetch(answer: (url: string) => Response) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    await gate;
    return answer(String(input));
  }));
  return () => release();
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('last time\'s week on Home', () => {
  it('draws the copy at once, held and marked updating, then the server\'s week replaces it', async () => {
    saveHomeSnapshot(KEY, { session: SESSION as never, players: [], announcement: null });
    const release = heldFetch((url) =>
      url.includes('/api/session') ? json(FRESH)
        : url.includes('/api/players/unpaid') ? json({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] })
          : url.includes('/api/kudos/eligible') ? json({ eligible: [] })
            : json([]));
    renderHome();
    expect(await screen.findByText('Copied Gym')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Updating…');
    expect(document.querySelector('.bpm-home-week')?.getAttribute('aria-busy')).toBe('true');
    release();
    expect(await screen.findByText('Fresh Gym')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Updating…')).toBeNull());
    // And the server's week is the copy for next time.
    expect(readHomeSnapshot(KEY)?.session.locationName).toBe('Fresh Gym');
  });

  it('a refresh that fails shows the error, never the old week', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    saveHomeSnapshot(KEY, { session: SESSION as never, players: [], announcement: null });
    const release = heldFetch(() => json({}, 500));
    renderHome();
    expect(await screen.findByText('Copied Gym')).toBeTruthy();
    release();
    expect(await screen.findByText("Couldn't load this week's session.")).toBeTruthy();
    expect(screen.queryByText('Copied Gym')).toBeNull();
  });
});

describe('the copy\'s rules', () => {
  it('belongs to one member in one club, and goes stale after a week', () => {
    saveHomeSnapshot(KEY, { session: SESSION as never, players: [], announcement: null }, 1_000);
    expect(readHomeSnapshot(KEY, 2_000)).not.toBeNull();
    expect(readHomeSnapshot(homeSnapshotKey('other-club', 'Lin'), 2_000)).toBeNull();
    expect(readHomeSnapshot(homeSnapshotKey('bpm', 'Viktor'), 2_000)).toBeNull();
    expect(readHomeSnapshot(KEY, 1_000 + HOME_SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it('sign-out forgets it', async () => {
    saveHomeSnapshot(KEY, { session: SESSION as never, players: [], announcement: null });
    await clearDeviceTraces(10);
    expect(readHomeSnapshot(KEY)).toBeNull();
  });
});
