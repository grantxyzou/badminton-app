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
    expect(screen.getByRole('button', { name: 'Coming Soon' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy();
  });

  it('renders zh-CN tab labels', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByRole('button', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '报名' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '即将推出' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '管理' })).toBeTruthy();
  });

  it('splits EN "Coming Soon" into two stacked lines', () => {
    const { container } = renderWithLocale('en');
    const skillsBtn = screen.getByRole('button', { name: 'Coming Soon' });
    const blocks = skillsBtn.querySelectorAll('span.block');
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.textContent).toBe('Coming');
    expect(blocks[1]?.textContent).toBe('Soon');
    expect(container).toBeTruthy();
  });

  it('renders zh-CN skills label as a single line (no whitespace split)', () => {
    renderWithLocale('zh-CN');
    const skillsBtn = screen.getByRole('button', { name: '即将推出' });
    const blocks = skillsBtn.querySelectorAll('span.block');
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.textContent).toBe('即将推出');
  });

  it('hides admin tab when showAdmin is false', () => {
    renderWithLocale('en', false);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(3);
  });
});
