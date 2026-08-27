// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * The client half of multi-provider auth.
 *
 * The server has always written `?signedIn=1`, `?authError=…`, `?verified=…`
 * and `?reset=…` on redirect; nothing read them. A returning Google user
 * therefore succeeded server-side and got a signed-out app, because
 * `badminton_identity` — which is what ProfileTab and HomeTab actually read —
 * was never written.
 *
 * Tabs are stubbed: this is about HomeShell's own decisions, and the real tabs
 * would drag their fetches into a test that is not about them.
 */
vi.mock('@/components/HomeTab', () => ({ default: () => <div data-testid="home-tab" /> }));
vi.mock('@/components/PlayersTab', () => ({ default: () => null }));
vi.mock('@/components/SkillsTab', () => ({ default: () => null }));
vi.mock('@/components/ProfileTab', () => ({ default: () => null }));
vi.mock('@/components/BottomNav', () => ({ default: () => null }));
vi.mock('@/components/GlassPhysics', () => ({ default: () => null }));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/LanguageToggle', () => ({ default: () => null }));
vi.mock('@/components/PullToRefresh', () => ({ default: () => null }));

import HomeShell from '../../components/HomeShell';

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

/** `me` decides the whoami answer; everything else answers benignly. */
function mockFetch(me: () => Promise<Response>, session: unknown = { id: 'session-1' }) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) return me();
      if (url.includes('/api/session')) return json(session);
      if (url.includes('/api/admin')) return json({ authed: false });
      if (url.includes('/api/stats/insight')) return json({});
      return json({});
    }),
  );
}

function at(search: string) {
  window.history.replaceState({}, '', `/bpm${search}`);
}

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeShell initialAnnouncement={null} />
    </NextIntlClientProvider>,
  );
}

function storedIdentity() {
  const raw = localStorage.getItem('badminton_identity');
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  at('');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('?signedIn=1 — the headline bug', () => {
  it('writes the identity from the server and says so', async () => {
    at('?signedIn=1&provider=google');
    mockFetch(() => json({ signedIn: true, name: 'Lin' }));
    renderShell();

    await waitFor(() => expect(storedIdentity()?.name).toBe('Lin'));
    expect(await screen.findByText("You're in")).toBeDefined();
  });

  it('strips signedIn and provider from the URL', async () => {
    at('?signedIn=1&provider=google');
    mockFetch(() => json({ signedIn: true, name: 'Lin' }));
    renderShell();
    await waitFor(() => expect(storedIdentity()?.name).toBe('Lin'));
    expect(window.location.search).toBe('');
  });

  it('still writes identity when /api/session never resolves', async () => {
    // The ordering-hazard regression test. `resolveStaleIdentity` treats an
    // empty sessionId as "keep", so '' is safe — and gating the identity write
    // on the session fetch would mean a hung request loses the sign-in
    // entirely, which is the bug this whole file exists for.
    at('?signedIn=1&provider=google');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) return json({ signedIn: true, name: 'Lin' });
        if (url.includes('/api/session')) return new Promise<Response>(() => {}); // never settles
        return json({});
      }),
    );
    renderShell();

    await waitFor(() => expect(storedIdentity()?.name).toBe('Lin'));
    expect(storedIdentity()?.sessionId).toBe('');
  });

  it('says so, and writes nothing, when the server reports KNOWN signed-out', async () => {
    at('?signedIn=1');
    mockFetch(() => json({ signedIn: false, name: null }));
    renderShell();

    expect(await screen.findByText(/couldn't confirm it/i)).toBeDefined();
    expect(storedIdentity()).toBeNull();
  });

  it('does nothing at all on an UNKNOWN answer, and leaves an existing identity alone', async () => {
    // `signedIn: null` is the throttled shape. Treating it as signed-out would
    // let a burst of requests log someone out of their own app.
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Existing', token: 't', sessionId: 's' }),
    );
    at('?signedIn=1');
    mockFetch(() => json({ signedIn: null, name: null }));
    renderShell();

    await waitFor(() => expect(window.location.search).toBe(''));
    expect(storedIdentity()?.name).toBe('Existing');
    expect(screen.queryByText(/couldn't confirm it/i)).toBeNull();
  });

  it('does nothing on a network failure — the offline banner owns that', async () => {
    at('?signedIn=1');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('/api/auth/me')
          ? Promise.reject(new Error('offline'))
          : json({}),
      ),
    );
    renderShell();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(storedIdentity()).toBeNull();
  });
});

describe('?authError', () => {
  it('surfaces a known reason and strips the param', async () => {
    at('?authError=state_mismatch');
    mockFetch(() => json({ signedIn: false }));
    renderShell();

    expect(await screen.findByText(/didn't finish/i)).toBeDefined();
    expect(screen.getByText(/took too long, or something interrupted it/i)).toBeDefined();
    expect(window.location.search).toBe('');
  });

  it('degrades an UNKNOWN reason to generic copy, never a raw identifier', async () => {
    at('?authError=some_future_reason');
    mockFetch(() => json({ signedIn: false }));
    renderShell();

    expect(await screen.findByText(/Something got in the way/i)).toBeDefined();
    expect(screen.queryByText(/some_future_reason/)).toBeNull();
  });

  it('lands even when a ?tab= is also present', async () => {
    // The placement regression: the tab branch `return`s early, so a notice
    // read after it would be silently dropped.
    at('?tab=profile&authError=exchange_failed');
    mockFetch(() => json({ signedIn: false }));
    renderShell();

    expect(await screen.findByText(/didn't finish/i)).toBeDefined();
  });
});

describe('?verified', () => {
  it('confirms a successful verification', async () => {
    at('?verified=1');
    mockFetch(() => json({ signedIn: false }));
    renderShell();
    expect(await screen.findByText('Email confirmed')).toBeDefined();
    expect(window.location.search).toBe('');
  });

  it('gives one neutral answer for used, expired and already-confirmed', async () => {
    // The endpoint deliberately cannot distinguish them, so neither may this.
    at('?verified=0');
    mockFetch(() => json({ signedIn: false }));
    renderShell();
    expect(await screen.findByText(/didn't work/i)).toBeDefined();
    expect(screen.getByText(/already been used or expired/i)).toBeDefined();
  });
});

describe('?reset', () => {
  it('opens the sheet and strips the live credential from the URL', async () => {
    at('?reset=tok123&email=lin%40example.com');
    mockFetch(() => json({ signedIn: false }));
    renderShell();

    expect(await screen.findByText('Pick a new password')).toBeDefined();
    // The token must not survive in history or in the URL the PWA restores.
    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain('tok123');
  });

  it('leaves an unrelated ?email= alone when there is no reset token', async () => {
    at('?email=someone%40example.com');
    mockFetch(() => json({ signedIn: false }));
    renderShell();
    await waitFor(() => expect(screen.getByTestId('home-tab')).toBeDefined());
    expect(window.location.search).toContain('email=');
  });
});
