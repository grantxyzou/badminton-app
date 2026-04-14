// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import LanguageToggle from '../../components/LanguageToggle';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderWithLocale(locale: 'en' | 'zh-CN') {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      <LanguageToggle />
    </NextIntlClientProvider>,
  );
}

describe('LanguageToggle', () => {
  afterEach(() => {
    cleanup();
    refreshMock.mockClear();
    document.cookie = 'NEXT_LOCALE=; path=/bpm; max-age=0';
  });

  it('renders a single icon button', () => {
    renderWithLocale('en');
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe('translate');
  });

  it('shows aria-label pointing to the OTHER locale (English → 中文)', () => {
    renderWithLocale('en');
    expect(screen.getByRole('button', { name: 'Switch to 中文' })).toBeTruthy();
  });

  it('shows aria-label pointing to the OTHER locale (zh-CN → English)', () => {
    renderWithLocale('zh-CN');
    expect(screen.getByRole('button', { name: 'Switch to English' })).toBeTruthy();
  });

  it('clicking from en writes zh-CN cookie and refreshes', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 中文' }));
    expect(document.cookie).toContain('NEXT_LOCALE=zh-CN');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('clicking from zh-CN writes en cookie and refreshes', () => {
    renderWithLocale('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    expect(document.cookie).toContain('NEXT_LOCALE=en');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
