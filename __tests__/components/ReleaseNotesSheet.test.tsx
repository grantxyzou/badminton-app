// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ReleaseNotesSheet from '../../components/ReleaseNotesSheet';
import enMessages from '../../messages/en.json';
import zhMessages from '../../messages/zh-CN.json';
import type { Release } from '../../lib/types';

const sampleReleases: Release[] = [
  {
    id: 'r-2',
    version: 'v0.2.0',
    title: { en: 'Second', 'zh-CN': '第二个' },
    body: { en: 'Content two', 'zh-CN': '内容二' },
    publishedAt: '2026-04-15T10:00:00Z',
    publishedBy: 'admin',
  },
  {
    id: 'r-1',
    version: 'v0.1.0',
    title: { en: 'First', 'zh-CN': '第一个' },
    body: { en: 'Content one', 'zh-CN': '内容一' },
    publishedAt: '2026-04-14T10:00:00Z',
    publishedBy: 'admin',
  },
];

function renderSheet(opts: { locale?: 'en' | 'zh-CN'; open?: boolean; releases?: Release[]; onClose?: () => void } = {}) {
  const { locale = 'en', open = true, releases = sampleReleases, onClose = vi.fn() } = opts;
  const messages = locale === 'en' ? enMessages : zhMessages;
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ReleaseNotesSheet open={open} releases={releases} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe('ReleaseNotesSheet', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('badminton_last_read_release');
  });

  it('renders full history in EN', () => {
    renderSheet({ locale: 'en' });
    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText(/Content one/)).toBeTruthy();
    expect(screen.getByText(/Content two/)).toBeTruthy();
  });

  it('renders in zh-CN locale', () => {
    renderSheet({ locale: 'zh-CN' });
    expect(screen.getByText('第一个')).toBeTruthy();
    expect(screen.getByText('第二个')).toBeTruthy();
  });

  it('writes latest version to localStorage on close', () => {
    const onClose = renderSheet({ locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(localStorage.getItem('badminton_last_read_release')).toBe('v0.2.0');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when open is false', () => {
    renderSheet({ open: false });
    expect(screen.queryByText('First')).toBeNull();
  });
});
