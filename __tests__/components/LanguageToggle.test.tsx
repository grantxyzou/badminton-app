// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import LanguageToggle from '../../components/LanguageToggle';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { deepMerge, type MessageTree } from '@/lib/messageTree';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderWithLocale(locale: 'en' | 'zh-CN') {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === 'en' ? en : deepMerge(en as unknown as MessageTree, zh as unknown as MessageTree)}
    >
      <LanguageToggle />
    </NextIntlClientProvider>,
  );
}

describe('LanguageToggle', () => {
  afterEach(() => {
    cleanup();
    refreshMock.mockClear();
    vi.unstubAllGlobals();
    localStorage.clear();
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
    // Spoken in the page's language (audit, 2026-11-05), naming the other one.
    expect(screen.getByRole('button', { name: '切换到English' })).toBeTruthy();
  });

  it('clicking from en writes zh-CN cookie and refreshes', () => {
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 中文' }));
    expect(document.cookie).toContain('NEXT_LOCALE=zh-CN');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('clicking from zh-CN writes en cookie and refreshes', () => {
    renderWithLocale('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '切换到English' }));
    expect(document.cookie).toContain('NEXT_LOCALE=en');
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('a signed-in member tells their devices the new language, for pushes', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin' }));
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 中文' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/push\/subscribe$/);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ locale: 'zh-CN' });
  });

  it('a signed-out visitor sends nothing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithLocale('en');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to 中文' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
