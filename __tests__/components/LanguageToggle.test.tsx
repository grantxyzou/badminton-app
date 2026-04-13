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

  it('renders both language options', () => {
    renderWithLocale('en');
    expect(screen.getByRole('radio', { name: 'EN' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '中文' })).toBeTruthy();
  });

  it('marks the current locale as active', () => {
    renderWithLocale('zh-CN');
    const zh = screen.getByRole('radio', { name: '中文' });
    const en = screen.getByRole('radio', { name: 'EN' });
    expect(zh.getAttribute('aria-checked')).toBe('true');
    expect(en.getAttribute('aria-checked')).toBe('false');
    expect(zh.className).toContain('segment-tab-active');
    expect(en.className).toContain('segment-tab-inactive');
  });

  it('writes the cookie and calls router.refresh when a different locale is clicked', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('radio', { name: '中文' }));
    expect(document.cookie).toContain('NEXT_LOCALE=zh-CN');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the active locale is re-clicked', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('radio', { name: 'EN' }));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
