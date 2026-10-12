// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import AdminDashboard from '@/components/admin/AdminDashboard';
import enMessages from '../../messages/en.json';

/**
 * Admin audit, 2026-10-12: HomeShell keys the admin tab on its refresh nonce,
 * so a pull-to-refresh remounted the console at the dashboard from any
 * sub-page. The page is kept in sessionStorage now, and leaving admin forgets it.
 */
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (onExit = () => {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AdminDashboard onExit={onExit} />
    </NextIntlClientProvider>,
  );

describe('the admin page survives a refresh', () => {
  it('reopens the sub-page it was on', async () => {
    sessionStorage.setItem('badminton_admin_view', 'skip-dates');
    wrap();
    expect(await screen.findByRole('heading', { name: 'Skip dates' })).toBeDefined();
  });

  it('ignores a page that cannot stand alone', async () => {
    // Payments needs the session it was opened for.
    sessionStorage.setItem('badminton_admin_view', 'payments');
    wrap();
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeDefined();
  });

  it('forgets it once you are back on the dashboard', async () => {
    sessionStorage.setItem('badminton_admin_view', 'skip-dates');
    const onExit = vi.fn();
    wrap(onExit);
    await screen.findByRole('heading', { name: 'Skip dates' });
    fireEvent.click(screen.getAllByRole('button', { name: /back/i })[0]);
    // Back from a sub-page goes to the dashboard and stores that.
    expect(sessionStorage.getItem('badminton_admin_view')).toBeNull();
  });
});
