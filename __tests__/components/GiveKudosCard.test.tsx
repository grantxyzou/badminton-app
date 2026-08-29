// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GiveKudosCard from '../../components/stats/GiveKudosCard';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

/**
 * REWRITTEN 2026-08-29 for the kudos redesign, and the old contract is now the
 * bug.
 *
 * This file used to assert "renders NOTHING outside the 48h window — the card
 * is designed to be absent". That design is what real users hit: both the
 * window and the co-player list keyed off the ACTIVE session, which the owner
 * advances minutes after play, so the card was invisible almost always. A
 * player asked "how do I give kudos to other people?" and could not find it;
 * the owner's own answer was wrong, because the rule was roster-based all
 * along and nobody could see it.
 *
 * THE NEW CONTRACT: the card ALWAYS renders, and always says which state it is
 * in. An absent card is indistinguishable from a feature that does not exist.
 */

const K = enMessages.stats.kudos;

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

function mockEligible(impl: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/kudos/eligible')) return impl();
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }),
  );
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <GiveKudosCard />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

/** The card subscribes to the active name, so every case needs one — see the
 *  comment on `useActiveName` in the component. */
function signIn(name = 'Lin') {
  localStorage.setItem('badminton_identity', JSON.stringify({ name, token: 't', sessionId: 's' }));
}

beforeEach(() => { localStorage.clear(); signIn(); });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GiveKudosCard — always present', () => {
  /** The headline of the redesign. */
  it('renders the card even when there is nobody to thank', async () => {
    mockEligible(() => json({ names: [] }));
    const { container } = wrap();

    expect(await screen.findByText(K.giveTitle)).toBeTruthy();
    // ...and explains WHY it is empty rather than vanishing.
    expect(await screen.findByText(K.emptyHint)).toBeTruthy();
    expect(container.firstChild).not.toBeNull();
  });

  /* `useActiveName` resolves in an effect (reading localStorage during render
     would desync SSR), so loading is reached on the tick after mount. */
  it('renders the card while still loading', async () => {
    mockEligible(() => new Promise(() => {}) as Promise<Response>); // never settles
    wrap();
    expect(screen.getByText(K.giveTitle)).toBeTruthy();
    expect(await screen.findByText(K.loading)).toBeTruthy();
  });

  it('offers the action when there ARE co-players', async () => {
    mockEligible(() => json({ names: ['Lin', 'Viktor'] }));
    wrap();
    expect(await screen.findByRole('button', { name: K.giveCta })).toBeTruthy();
  });

  /**
   * Unknown is not empty. A broken read must not render as the designed
   * "nobody to thank" state — that is the lying-empty-state rule.
   */
  it('shows an ERROR, not an empty state, when the read fails', async () => {
    mockEligible(() => json({ error: 'load_failed' }, 500));
    wrap();
    expect(await screen.findByText(K.error)).toBeTruthy();
    expect(screen.queryByText(K.emptyHint)).toBeNull();
  });

  it('shows an error when the read throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    wrap();
    expect(await screen.findByText(K.error)).toBeTruthy();
  });

  /**
   * Signed out is a legitimate "nothing here", not a fault — the card should
   * not shout an error at someone who simply has not signed in.
   */
  it('treats 401 as the empty state, not an error', async () => {
    mockEligible(() => json({ error: 'auth_required' }, 401));
    wrap();
    expect(await screen.findByText(K.emptyHint)).toBeTruthy();
    expect(screen.queryByText(K.error)).toBeNull();
  });

  /* Signed out is quiet, and costs no request: there is no cookie to resolve. */
  it('shows the empty state without fetching when signed out', async () => {
    localStorage.clear();
    const spy = vi.fn(() => json({ names: ['Lin'] }));
    mockEligible(spy);
    wrap();
    expect(await screen.findByText(K.emptyHint)).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not compute eligibility itself — it asks the server', async () => {
    const spy = vi.fn(() => json({ names: [] }));
    mockEligible(spy);
    wrap();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Exactly one source of truth; no roster or games read from here.
    const urls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.every((u) => u.includes('/api/kudos/eligible'))).toBe(true);
  });
});
