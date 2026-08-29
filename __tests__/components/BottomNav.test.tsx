// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BottomNav from '../../components/BottomNav';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';


function renderWithLocale(locale: 'en' | 'zh-CN') {
  const messages = locale === 'en' ? enMessages : zhMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BottomNav activeTab="home" onTabChange={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

/* Was "must hold in BOTH flag branches". There is one nav now — the rail — so
   this is simply the nav's contract. Kept as a function rather than inlined
   because it is the list of promises the nav makes, and naming it that way is
   what stopped the two branches drifting while there were two. */
function sharedContract() {

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
describe('BottomNav — Labeled Rail', () => {
  sharedContract();

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
