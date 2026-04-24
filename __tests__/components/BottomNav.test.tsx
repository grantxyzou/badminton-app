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

  it('renders EN skills label as a single line — canonical spec (preview/19)', () => {
    renderWithLocale('en');
    // Canonical spec dropped the whitespace-split "Coming Soon" stacking.
    // Label is now a single <span> alongside the `school` icon.
    const skillsBtn = screen.getByRole('button', { name: 'Coming Soon' });
    // No `.block` children — the stacked rendering is removed.
    expect(skillsBtn.querySelectorAll('span.block').length).toBe(0);
    // The label text renders verbatim.
    expect(skillsBtn.textContent).toContain('Coming Soon');
  });

  it('renders zh-CN skills label as a single line (verbatim, no whitespace split)', () => {
    renderWithLocale('zh-CN');
    const skillsBtn = screen.getByRole('button', { name: '即将推出' });
    expect(skillsBtn.querySelectorAll('span.block').length).toBe(0);
    expect(skillsBtn.textContent).toContain('即将推出');
  });

  it('hides admin tab when showAdmin is false', () => {
    renderWithLocale('en', false);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    expect(screen.getAllByRole('button').length).toBe(3);
  });
});
