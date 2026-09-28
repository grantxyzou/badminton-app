// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import { resetSharedReads } from '@/lib/sharedRead';

/**
 * The buzz and the burst are ONE moment (docs/plans/signup-shuttle-burst.md).
 *
 * The tap used to fire as the server answered, and the shuttles only once the
 * button-to-banner morph had finished (~250 ms later, because Safari paints a
 * View Transition from static snapshots). Felt, then seen: two events. This
 * holds the morph open and pins that nothing is felt until it ends, and that
 * the tap and the burst then arrive in the same callback. The haptics code is
 * also primed when the request STARTS, so its first download cannot make the
 * tap late on its own.
 */

const haptics = vi.hoisted(() => ({ tapSuccess: vi.fn(), primeHaptics: vi.fn() }));
vi.mock('@/lib/haptics', () => haptics);

/** The morph, held open: `finish()` is the moment the transition settles. */
const morph = vi.hoisted(() => ({ finish: null as null | (() => void) }));
vi.mock('@/lib/viewTransition', () => ({
  canViewTransition: () => true,
  withViewTransition: (update: () => void, _scope?: string, onFinished?: () => void) => {
    update();
    morph.finish = onFinished ?? null;
    return true;
  },
}));

import HomeTab from '@/components/HomeTab';

const session = {
  id: 'session-2026-09-17',
  maxPlayers: 12,
  signupOpen: true,
  datetime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  locationName: 'Test Gym',
};

function ok(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  localStorage.clear();
  resetSharedReads();
  morph.finish = null;
  haptics.tapSuccess.mockClear();
  haptics.primeHaptics.mockClear();
  let roster = [{ id: 'p1', name: 'Viktor', waitlisted: false }];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/session')) return ok(session);
    if (url.includes('/api/players/unpaid')) return ok({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] });
    if (url.includes('/api/stringing/shop')) return ok({ open: false });
    if (url.includes('/api/players') && init?.method === 'POST') {
      // The request has started by now: the code must already be on its way.
      expect(haptics.primeHaptics).toHaveBeenCalledOnce();
      const row = { id: 'p2', name: 'Lin', waitlisted: false, sessionId: session.id };
      roster = [...roster, row];
      return ok({ ...row, deleteToken: 't'.repeat(32) }, 201);
    }
    if (url.includes('/api/players')) return ok(roster);
    return ok([]);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the sign-up tap and the shuttle burst', () => {
  it('are felt and seen together, once the morph has landed — not before', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HomeTab memberName="Lin" />
      </NextIntlClientProvider>,
    );
    await screen.findByText('Signing up as Lin');
    fireEvent.click(screen.getByRole('button', { name: /I'm in/i }));

    // The server has confirmed and the banner is up, but the morph is still
    // running: nothing felt, nothing flying.
    expect(await screen.findByText("Lin, you're in")).toBeDefined();
    expect(morph.finish).not.toBeNull();
    expect(haptics.tapSuccess).not.toHaveBeenCalled();
    expect(document.querySelector('.shuttle-burst')).toBeNull();

    // The morph settles: the tap and the burst arrive in the same moment.
    act(() => morph.finish?.());
    expect(haptics.tapSuccess).toHaveBeenCalledOnce();
    expect(document.querySelector('.shuttle-burst')).not.toBeNull();
  });
});
