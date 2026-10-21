// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * Tabs are kept once visited and opened early behind the launch screen
 * (docs/plans/tab-keep-alive.md). Grant, 2026-10-21: "it still has a lot of
 * loading stats everytime i tap on a new page" — every tap destroyed the tab
 * you left and rebuilt the one you went to, five to fourteen requests and a
 * skeleton each time, even for a tab seen seconds before.
 *
 * The tabs are stubs that count their mounts: a kept tab mounts once.
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
vi.mock('@/components/PullToRefresh', () => ({
  default: ({ onRefresh }: { onRefresh: () => Promise<void> }) => (
    <button type="button" onClick={() => void onRefresh()}>
      pull
    </button>
  ),
}));
vi.mock('@/components/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/LanguageToggle', () => ({ default: () => null }));

import HomeShell from '../../components/HomeShell';

function renderShell(memberName: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeShell initialAnnouncement={null} memberName={memberName} />
    </NextIntlClientProvider>,
  );
}

const panel = (tab: string) => screen.getByTestId(`${tab}-tab`).closest('[data-tab-panel]') as HTMLElement;

/** Turns preloading off, as the browser's "save data" setting does. */
function saveData(on: boolean) {
  Object.defineProperty(navigator, 'connection', { value: on ? { saveData: true } : undefined, configurable: true });
}

beforeEach(() => {
  for (const k of Object.keys(h.mounts)) delete h.mounts[k];
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin', token: '', sessionId: '' }));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)),
  );
});

afterEach(() => {
  cleanup();
  saveData(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a tab you leave is kept, not rebuilt', () => {
  it('Home → Stats → Home mounts each tab once, and hides the one you left', async () => {
    saveData(true);
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));

    fireEvent.click(screen.getByText('go-skills'));
    await waitFor(() => expect(h.mounts.skills).toBe(1));
    expect(panel('home').hidden).toBe(true);
    expect(panel('skills').hidden).toBe(false);
    expect(screen.getByTestId('home-tab').dataset.active).toBe('false');

    fireEvent.click(screen.getByText('go-home'));
    expect(panel('home').hidden).toBe(false);
    expect(screen.getByTestId('home-tab').dataset.active).toBe('true');
    expect(h.mounts).toEqual({ home: 1, skills: 1 });
  });

  it('a pull refreshes the tab on screen and leaves the kept ones alone', async () => {
    saveData(true);
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));
    fireEvent.click(screen.getByText('go-profile'));
    await waitFor(() => expect(h.mounts.profile).toBe(1));

    fireEvent.click(screen.getByText('pull'));
    await waitFor(() => expect(h.mounts.profile).toBe(2));
    expect(h.mounts.home).toBe(1);
  });

  it('a restored tab is resolved before anything is kept: Home is not fetched behind it', async () => {
    saveData(true);
    sessionStorage.setItem('badminton_active_tab', 'skills');
    renderShell();
    await waitFor(() => expect(h.mounts.skills).toBe(1));
    // The SSR'd Home was only a placeholder for the restore.
    expect(screen.queryByTestId('home-tab')).toBeNull();
  });
});

describe('the other tabs open early, hidden', () => {
  it('once the first screen has settled, every tab is mounted behind it', async () => {
    renderShell();
    await waitFor(() => expect(h.mounts).toEqual({ home: 1, stringing: 1, skills: 1, profile: 1 }));
    expect(panel('home').hidden).toBe(false);
    for (const t of ['stringing', 'skills', 'profile']) {
      expect(panel(t).hidden).toBe(true);
      expect(screen.getByTestId(`${t}-tab`).dataset.active).toBe('false');
    }
    // And the first tap on one is a switch, not a load.
    fireEvent.click(screen.getByText('go-stringing'));
    expect(h.mounts.stringing).toBe(1);
    expect(screen.getByTestId('stringing-tab').dataset.active).toBe('true');
  });

  it('not when the browser asks to save data', async () => {
    saveData(true);
    renderShell();
    await waitFor(() => expect(h.mounts.home).toBe(1));
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(h.mounts).toEqual({ home: 1 });
  });

  it('not for a visitor with no identity', async () => {
    localStorage.clear();
    renderShell(null);
    await waitFor(() => expect(h.mounts.home).toBe(1));
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(h.mounts).toEqual({ home: 1 });
  });
});
