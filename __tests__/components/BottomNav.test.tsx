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

describe('BottomNav — auth-revamp permanent state', () => {
  afterEach(cleanup);

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

  it('renders EN stats label as a single line', () => {
    renderWithLocale('en');
    const skillsBtn = screen.getByRole('button', { name: 'Stats' });
    expect(skillsBtn.querySelectorAll('span.block').length).toBe(0);
    expect(skillsBtn.textContent).toContain('Stats');
  });

  it('uses bar_chart icon for stats tab', () => {
    renderWithLocale('en');
    const skillsBtn = screen.getByRole('button', { name: 'Stats' });
    expect(skillsBtn.textContent).toContain('bar_chart');
  });

  it('marks the active tab with nav-tab-active and the rest with only nav-tab', () => {
    renderWithLocale('en');
    const homeBtn = screen.getByRole('button', { name: 'Home' });
    const playersBtn = screen.getByRole('button', { name: 'Sign-Ups' });
    expect(homeBtn.classList.contains('nav-tab')).toBe(true);
    expect(homeBtn.classList.contains('nav-tab-active')).toBe(true);
    expect(playersBtn.classList.contains('nav-tab')).toBe(true);
    expect(playersBtn.classList.contains('nav-tab-active')).toBe(false);
  });

  it('flips the icon FILL axis only on the active tab', () => {
    renderWithLocale('en');
    const homeIcon = screen.getByRole('button', { name: 'Home' }).querySelector('.material-icons');
    const playersIcon = screen
      .getByRole('button', { name: 'Sign-Ups' })
      .querySelector('.material-icons');
    expect(homeIcon?.classList.contains('nav-tab-icon-active')).toBe(true);
    expect(playersIcon?.classList.contains('nav-tab-icon-active')).toBe(false);
  });
});
