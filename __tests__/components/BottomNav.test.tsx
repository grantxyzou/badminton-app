// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import BottomNav from '../../components/BottomNav';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';

function renderWithLocale(locale: 'en' | 'zh-CN', showAdmin = true) {
  const messages = locale === 'en' ? enMessages : zhMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <BottomNav activeTab="home" onTabChange={vi.fn()} showAdmin={showAdmin} />
    </NextIntlClientProvider>,
  );
}

describe('BottomNav — i18n', () => {
  afterEach(cleanup);

  it('renders English tab labels', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign-Ups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('renders zh-CN tab labels', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByRole('button', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '报名' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '数据' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
  });

  it('renders EN stats label as a single line', () => {
    renderWithLocale('en');
    const skillsBtn = screen.getByRole('button', { name: 'Stats' });
    expect(skillsBtn.querySelectorAll('span.block').length).toBe(0);
    expect(skillsBtn.textContent).toContain('Stats');
  });

  it('renders zh-CN stats label as a single line', () => {
    renderWithLocale('zh-CN');
    const skillsBtn = screen.getByRole('button', { name: '数据' });
    expect(skillsBtn.querySelectorAll('span.block').length).toBe(0);
    expect(skillsBtn.textContent).toContain('数据');
  });

  it('uses bar_chart icon for stats tab', () => {
    renderWithLocale('en');
    const skillsBtn = screen.getByRole('button', { name: 'Stats' });
    expect(skillsBtn.textContent).toContain('bar_chart');
  });

  it('hides admin tab when showAdmin is false', () => {
    renderWithLocale('en', false);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(3);
  });
});
