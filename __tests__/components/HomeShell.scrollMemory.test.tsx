// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * Each tab keeps its own scroll position (`.claude/rules/app-shell.md`).
 *
 * In this app the BODY is the scroller (`html, body { height: 100% }`), so
 * `window.scrollY` reads 0 however far down the page is, `window.scrollTo`
 * moves nothing, and a body `scroll` event never reaches a `window` listener
 * (`lib/pageScroll.ts`). The shell read and wrote the window until 2026-11-10,
 * so the memory was never written and every tab shared one position: Home
 * scrolled to 100, Stats opened at 100, and coming back to Home after Stats
 * landed wherever Stats had been, clamped to Home's height.
 *
 * jsdom has no layout, so these tests stand the body up as the scroller: a
 * `scrollTop` that holds its value, and a `scroll` event dispatched on the
 * body, which (like a real one) does not bubble.
 */
const h = vi.hoisted(() => ({ mounts: {} as Record<string, number> }));
vi.mock('@/components/HomeTab', async () => (await import('./tabStub')).tabStub('home', h.mounts));
vi.mock('@/components/StringingTab', async () => (await import('./tabStub')).tabStub('stringing', h.mounts));
vi.mock('@/components/SkillsTab', async () => (await import('./tabStub')).tabStub('skills', h.mounts));
vi.mock('@/components/ProfileTab', async () => (await import('./tabStub')).tabStub('profile', h.mounts));
vi.mock('@/components/BottomNav', () => ({
  default: ({ onTabChange }: { onTabChange: (t: string) => void }) => (
    <nav>
      {['home', 'stringing', 'skills', 'profile'].map((t) => (
        <button key={t} type="button" onClick={() => onTabChange(t)}>
          go-{t}
        </button>
      ))}
    </nav>
  ),
}));
vi.mock('@/components/PullToRefresh', () => ({ default: () => null }));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/LanguageToggle', () => ({ default: () => null }));

import HomeShell from '../../components/HomeShell';

function renderShell() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeShell initialAnnouncement={null} memberName="Lin" />
    </NextIntlClientProvider>,
  );
}

/** The body scrolls; the window and `<html>` stay at 0, as on a phone. */
let bodyTop = 0;
function makeBodyTheScroller() {
  bodyTop = 0;
  Object.defineProperty(document.body, 'scrollTop', {
    configurable: true,
    get: () => bodyTop,
    set: (v: number) => { bodyTop = v; },
  });
  Object.defineProperty(document.documentElement, 'scrollTop', {
    configurable: true,
    get: () => 0,
    set: () => {},
  });
}

/** A finger scroll: the body moves and fires a non-bubbling `scroll` on itself. */
function scrollBodyTo(y: number) {
  act(() => {
    bodyTop = y;
    document.body.dispatchEvent(new Event('scroll', { bubbles: false }));
  });
}

beforeEach(() => {
  for (const k of Object.keys(h.mounts)) delete h.mounts[k];
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin', token: '', sessionId: '' }));
  // Preloading off, as under the browser's save-data setting: these tests are
  // about the scroll, and a hidden tab mounting late changes nothing here.
  Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)),
  );
  makeBodyTheScroller();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  delete (document.body as { scrollTop?: number }).scrollTop;
  delete (document.documentElement as { scrollTop?: number }).scrollTop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('each tab keeps its own scroll position, with the body as the scroller', () => {
  it('Home → Stats → Home → Stats returns each tab to where it was left', async () => {
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));

    scrollBodyTo(100);

    fireEvent.click(screen.getByText('go-skills'));
    await waitFor(() => expect(h.mounts.skills).toBe(1));
    expect(bodyTop, 'a tab never visited opens at its top').toBe(0);

    scrollBodyTo(500);

    fireEvent.click(screen.getByText('go-home'));
    expect(bodyTop, 'Home comes back where it was left').toBe(100);

    fireEvent.click(screen.getByText('go-skills'));
    expect(bodyTop, 'and so does Stats').toBe(500);
  });

  it('a scroll while a sheet pins the body is not saved as the tab position', async () => {
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));
    scrollBodyTo(240);

    // `useBodyScrollLock` pins the body; the page then reads 0.
    document.body.style.position = 'fixed';
    scrollBodyTo(0);
    document.body.style.position = '';

    fireEvent.click(screen.getByText('go-skills'));
    await waitFor(() => expect(h.mounts.skills).toBe(1));
    fireEvent.click(screen.getByText('go-home'));
    expect(bodyTop).toBe(240);
  });

  it('the notifications page opens at its top and closes back to where the tab was', async () => {
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));
    scrollBodyTo(180);

    const bell = await screen.findByRole('button', { name: 'Notifications' });
    fireEvent.click(bell);
    expect(bodyTop).toBe(0);

    // Scrolling the notifications page is not the tab's scroll.
    scrollBodyTo(60);

    fireEvent.click(bell);
    expect(bodyTop).toBe(180);
  });
});
