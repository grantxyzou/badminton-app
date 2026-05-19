// @vitest-environment jsdom
import { describe, it, expect, afterEach, afterAll, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BottomNav from '../../components/BottomNav';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

const FLAG = 'NEXT_PUBLIC_FLAG_NAV_RAIL';
const originalEnv = { ...process.env };

function renderWithLocale(locale: 'en' | 'zh-CN') {
  const messages = locale === 'en' ? enMessages : zhMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BottomNav activeTab="home" onTabChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);
afterAll(() => {
  process.env = originalEnv;
});

// ── Shared contract — must hold in BOTH flag branches ──
function sharedContract(setFlag: () => void) {
  beforeEach(setFlag);

  it('renders four tabs: Home, Sign-Ups, Stats, Profile (English)', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign-Ups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBe(4);
  });

  it('renders four tabs in zh-CN', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByRole('button', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '报名' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '数据' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '档案' })).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBe(4);
  });

  it('does NOT render an Admin tab — admin is reachable via Profile', () => {
    renderWithLocale('en');
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });

  it('uses bar_chart icon for the stats tab', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Stats' }).textContent).toContain('bar_chart');
  });

  it('marks the active tab with aria-current="page" only', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Stats' }).getAttribute('aria-current')).toBeNull();
  });
}

// ── Flag ON → Labeled Rail (bpm-next + dev) ──
describe('BottomNav — Labeled Rail (NEXT_PUBLIC_FLAG_NAV_RAIL on)', () => {
  sharedContract(() => {
    process.env[FLAG] = 'true';
  });

  it('renders the rail container, not the legacy glass pill', () => {
    const { container } = renderWithLocale('en');
    expect(container.querySelector('nav.rail-bar')).toBeTruthy();
    expect(container.querySelector('.nav-glass')).toBeNull();
  });

  it('active tab gets rail-tab-active; others only rail-tab', () => {
    renderWithLocale('en');
    const home = screen.getByRole('button', { name: 'Home' });
    const players = screen.getByRole('button', { name: 'Sign-Ups' });
    expect(home.classList.contains('rail-tab')).toBe(true);
    expect(home.classList.contains('rail-tab-active')).toBe(true);
    expect(players.classList.contains('rail-tab')).toBe(true);
    expect(players.classList.contains('rail-tab-active')).toBe(false);
  });

  it('wraps the icon in .rail-icon-wrap with the SAME glyph active & inactive (no FILL swap)', () => {
    renderWithLocale('en');
    const homeIcon = screen
      .getByRole('button', { name: 'Home' })
      .querySelector('.rail-icon-wrap .material-icons.rail-icon');
    const playersIcon = screen
      .getByRole('button', { name: 'Sign-Ups' })
      .querySelector('.rail-icon-wrap .material-icons.rail-icon');
    expect(homeIcon?.textContent).toContain('home');
    expect(playersIcon?.textContent).toContain('group');
    expect(homeIcon?.className).toBe(playersIcon?.className);
  });
});

// ── Flag OFF → legacy glass pill (bpm-stable rollback target) ──
describe('BottomNav — legacy glass nav (NEXT_PUBLIC_FLAG_NAV_RAIL off)', () => {
  sharedContract(() => {
    delete process.env[FLAG];
  });

  it('renders the legacy .nav-glass pill, not the rail', () => {
    const { container } = renderWithLocale('en');
    expect(container.querySelector('.nav-glass')).toBeTruthy();
    expect(container.querySelector('nav.rail-bar')).toBeNull();
  });

  it('active tab gets nav-tab-active and the active icon flips FILL via nav-tab-icon-active', () => {
    renderWithLocale('en');
    const home = screen.getByRole('button', { name: 'Home' });
    const players = screen.getByRole('button', { name: 'Sign-Ups' });
    expect(home.classList.contains('nav-tab')).toBe(true);
    expect(home.classList.contains('nav-tab-active')).toBe(true);
    expect(players.classList.contains('nav-tab-active')).toBe(false);
    const homeIcon = home.querySelector('.material-icons');
    const playersIcon = players.querySelector('.material-icons');
    expect(homeIcon?.classList.contains('nav-tab-icon-active')).toBe(true);
    expect(playersIcon?.classList.contains('nav-tab-icon-active')).toBe(false);
  });
});
