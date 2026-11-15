// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { useCurrentGroup } from '../lib/useCurrentGroup';
import { announceClubRun, useStringingHidden } from '../lib/useClubRun';
import { noteWrite, resetSharedReads } from '../lib/sharedRead';
import { clubRunOf } from '../lib/clubRun';

/**
 * A club switch re-reads EVERY copy of "which club am I in" (Grant,
 * 2026-11-15: "Stringer tab is gone on BPM core, setting has it on"). The
 * shell hides the Stringing tab through its own `useCurrentGroup`, and a
 * switch refreshed only Profile's copy, so the tab bar kept the club the
 * phone had just left — one with stringing off.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const club = { current: 'six' as 'six' | 'bpm' };
const CLUBS = {
  // A Members-first club: stringing is off unless the club turns it on.
  six: { id: 'six', name: 'Six Feathers', role: 'owner', rosterName: 'Grant', isOwner: true, memberCount: 32, settings: { run: clubRunOf({ run: { style: 'members_first' } }) } },
  bpm: { id: 'bpm', name: 'BPM Core', role: 'owner', rosterName: 'Grant', isOwner: true, memberCount: 40, settings: { run: clubRunOf(undefined) } },
};

beforeEach(() => {
  process.env[FLAG] = 'true';
  club.current = 'six';
  resetSharedReads();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Grant', sessionId: 's1' }));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/api/groups/current')) return jsonResponse(CLUBS[club.current]);
    if (url.endsWith('/api/groups/mine')) return jsonResponse({ groups: [] });
    return jsonResponse({}, 404);
  }));
});

afterEach(() => {
  cleanup();
  delete process.env[FLAG];
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** What GroupsPage does: the switch is a write, then the shell refreshes its own copy. */
function switchTo(next: 'six' | 'bpm', refresh: () => void) {
  club.current = next;
  noteWrite();
  act(() => refresh());
}

describe('a club switch', () => {
  it('re-reads every copy of the club, not only the caller\'s', async () => {
    const shell = renderHook(() => useCurrentGroup());
    const tabBar = renderHook(() => useCurrentGroup());
    await waitFor(() => expect(tabBar.result.current.group?.id).toBe('six'));

    switchTo('bpm', shell.result.current.refresh);

    await waitFor(() => expect(tabBar.result.current.group?.id).toBe('bpm'));
    expect(shell.result.current.group?.id).toBe('bpm');
  });

  it('brings back the Stringing tab on moving from a club with it off to BPM Core', async () => {
    const shell = renderHook(() => useCurrentGroup());
    const hidden = renderHook(() => useStringingHidden());
    await waitFor(() => expect(hidden.result.current).toBe(true));

    switchTo('bpm', shell.result.current.refresh);

    await waitFor(() => expect(hidden.result.current).toBe(false));
  });

  it('a settings save in one club is not read as another club\'s', async () => {
    const shell = renderHook(() => useCurrentGroup());
    const hidden = renderHook(() => useStringingHidden());
    await waitFor(() => expect(hidden.result.current).toBe(true));

    // Saved on Six Feathers' "How your club runs" (stringing still off there).
    act(() => announceClubRun(clubRunOf({ run: { style: 'members_first', stringing: 'off' } })));
    expect(hidden.result.current).toBe(true);

    switchTo('bpm', shell.result.current.refresh);

    await waitFor(() => expect(hidden.result.current).toBe(false));
  });
});
