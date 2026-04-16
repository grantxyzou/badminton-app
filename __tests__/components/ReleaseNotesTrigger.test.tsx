// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ReleaseNotesTrigger from '../../components/ReleaseNotesTrigger';
import enMessages from '../../messages/en.json';

const sampleReleases = [
  {
    id: 'r-1',
    version: 'v0.2.0',
    title: { en: 'Second', 'zh-CN': '第二' },
    body: { en: 'x', 'zh-CN': 'x' },
    publishedAt: '2026-04-15T10:00:00Z',
    publishedBy: 'admin' as const,
  },
];

function renderTrigger(opts: { releases?: unknown[]; storedVersion?: string | null; onOpen?: () => void } = {}) {
  const { releases = sampleReleases, storedVersion = null, onOpen = vi.fn() } = opts;
  if (storedVersion === null) {
    localStorage.removeItem('badminton_last_read_release');
  } else {
    localStorage.setItem('badminton_last_read_release', storedVersion);
  }
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ReleaseNotesTrigger releases={releases as never} onOpen={onOpen} />
    </NextIntlClientProvider>,
  );
  return onOpen;
}

describe('ReleaseNotesTrigger', () => {
  afterEach(() => {
    cleanup();
    localStorage.removeItem('badminton_last_read_release');
  });

  it('renders "What\'s new in v0.2.0" with sparkle when no stored version', () => {
    renderTrigger({ storedVersion: null });
    expect(screen.getByText(/What's new in v0.2.0/)).toBeTruthy();
    expect(screen.getByText(/✨/)).toBeTruthy();
  });

  it('renders "What\'s new in v0.2.0" when stored version is older', () => {
    renderTrigger({ storedVersion: 'v0.1.0' });
    expect(screen.getByText(/What's new in v0.2.0/)).toBeTruthy();
  });

  it('renders plain version when stored version matches latest', () => {
    renderTrigger({ storedVersion: 'v0.2.0' });
    expect(screen.getByText('v0.2.0')).toBeTruthy();
    expect(screen.queryByText(/What's new/)).toBeNull();
    expect(screen.queryByText(/✨/)).toBeNull();
  });

  it('calls onOpen when clicked', () => {
    const onOpen = renderTrigger({});
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when releases list is empty', () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ReleaseNotesTrigger releases={[]} onOpen={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
