// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';
import type { Announcement } from '@/lib/types';

/**
 * Loading cascade, phase 2 (docs/plans/loading-cascade.md): Home while its week
 * is still loading.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ANNOUNCEMENT = {
  id: 'a1',
  text: 'Courts 3 and 4 this week',
  time: '2026-10-01T10:00:00-07:00',
  sessionId: 'session-2026-10-02',
} as Announcement;

/** A fetch that never answers: Home stays in its loading state. */
const pending = () => vi.fn(() => new Promise<Response>(() => {}));

function renderHome(props: Partial<Parameters<typeof HomeTab>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab {...props} />
    </NextIntlClientProvider>,
  );
}

const visible = (el: Element | null) => !!el && !el.closest('[hidden]');

describe('Home while the week loads', () => {
  it('draws the server-rendered announcement on first paint, not a shimmer', () => {
    vi.stubGlobal('fetch', pending());
    renderHome({ initialAnnouncement: ANNOUNCEMENT });
    // The LCP element: in the page before any client fetch has answered.
    expect(visible(screen.getByText('Courts 3 and 4 this week'))).toBe(true);
    // Around it, the rest of the week is still skeleton.
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('reserves no announcement slot when the server found none', () => {
    vi.stubGlobal('fetch', pending());
    const { container } = renderHome({ initialAnnouncement: null });
    const skeleton = screen.getByRole('status', { name: 'Loading' });
    // Two tiles and the sign-up card. A fourth block would be a 120px gap the
    // sign-up card jumps up into when the week lands.
    expect(skeleton.querySelectorAll('.glass-card')).toHaveLength(3);
    expect(container.textContent).not.toContain('Announcement');
  });

  it('does not fetch until the shell has decided Home is the tab', async () => {
    const fetchMock = pending();
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = renderHome({ deferFetch: true });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HomeTab deferFetch={false} />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
