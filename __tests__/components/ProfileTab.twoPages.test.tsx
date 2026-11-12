// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import TopBar from '../../components/primitives/TopBar';
import { PaneDetail } from '../../components/primitives/PaneDetail';
import enMessages from '../../messages/en.json';

/**
 * Profile on a foldable's two pages (docs/plans/foldable-layout.md): the list
 * stays, the screen a row opens is on the right — Edit profile before any tap
 * — and its top bar has no Back, because the list it came from is beside it.
 * One screen: a row's screen replaces the list, as it always did. jsdom draws
 * no layout; the canary pins the CSS, this pins what renders.
 */
const originalFetch = global.fetch;

function stubPane(on: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: on && q.includes('horizontal-viewport-segments'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })));
}

function renderProfile() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <ProfileTab sessionId="session-2026-04-27" sessionLabel="Apr 27" isAdmin={false} onAdminTools={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }));
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/members/me')) return new Response(JSON.stringify({ hasPin: true, authed: true, createdAt: '2026-01-01' }), { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  global.fetch = originalFetch;
});

describe('Profile on two pages', () => {
  it('opens Edit profile on the right page before any tap, beside the list', async () => {
    stubPane(true);
    const { container } = renderProfile();
    await waitFor(() => expect(container.querySelector('.profile-detail')).not.toBeNull());
    const detail = container.querySelector('.profile-detail') as HTMLElement;
    expect(within(detail).getByRole('heading', { name: 'Edit profile' })).toBeDefined();
    // The list is still there, and its card says which page is open.
    expect(container.querySelector('.profile-list')).not.toBeNull();
    expect(container.querySelector('.profile-card-button[aria-current="page"]')).not.toBeNull();
    // No Back beside the list.
    expect(within(detail).queryByRole('button', { name: /back/i })).toBeNull();
  });

  it('opens a tapped row on the right page and marks the row', async () => {
    stubPane(true);
    const { container } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }));
    await waitFor(() => {
      const detail = container.querySelector('.profile-detail') as HTMLElement;
      expect(within(detail).getByRole('heading', { name: 'Support' })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /^Support/ }).getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('.profile-list')).not.toBeNull();
  });

  it('on one screen a row still opens its page in place of the list', async () => {
    stubPane(false);
    const { container } = renderProfile();
    fireEvent.click(await screen.findByRole('button', { name: /^Support/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Support' })).toBeDefined());
    expect(container.querySelector('.profile-shell, .profile-list, .profile-detail')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Support/ })).toBeNull();
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
  });
});

describe('TopBar beside a list', () => {
  it('drops Back and its Escape inside a right page, and keeps them for a nested page', () => {
    const onBack = vi.fn();
    const { rerender } = render(<PaneDetail><TopBar title="Roster" onBack={onBack} /></PaneDetail>);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).not.toHaveBeenCalled();
    rerender(<PaneDetail nested><TopBar title="Late cancellations" onBack={onBack} /></PaneDetail>);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('is unchanged outside a right page', () => {
    const onBack = vi.fn();
    render(<TopBar title="Roster" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
