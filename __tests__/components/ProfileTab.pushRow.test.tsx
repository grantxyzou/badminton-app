// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';

/**
 * Loading cascade follow-up. The Notifications row was hidden while the push
 * probe was unresolved and inserted when it answered, pushing every row below
 * it down. It is present from the first frame now — with NO status until the
 * probe answers, because "Off" before we know would be a confirmed negative
 * from an unknown state.
 */
const push = { status: 'loading' as string };
/** HomeShell owns the push state now and hands it down (shared with the
 *  Notifications page), so the test hands it down too. */
const pushResult = () =>
  ({ state: { status: push.status }, enable: vi.fn(), disable: vi.fn(), busy: false, error: null }) as unknown as UsePushResult;

import ProfileTab from '../../components/ProfileTab';
import type { UsePushResult } from '../../lib/usePush';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function signedInProfile(onOpenNotifications = vi.fn()) {
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 's' }));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const body = u.includes('/api/members/me')
        ? { hasPin: true, authed: true, createdAt: '2026-01-01' }
        : u.includes('/api/players') ? [] : {};
      return Promise.resolve({ ok: true, json: async () => body } as unknown as Response);
    }),
  );
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ProfileTab
        sessionId="s"
        sessionLabel="Apr 27"
        isAdmin={false}
        onAdminTools={() => {}}
        push={pushResult()}
        onOpenNotifications={onOpenNotifications}
      />
    </NextIntlClientProvider>,
  );
}

describe('Profile notifications row', () => {
  it('is there while the push probe is unresolved, saying nothing about its state', async () => {
    push.status = 'loading';
    signedInProfile();
    const row = (await screen.findByText(enMessages.profile.settings.notifications)).closest('button')!;
    expect(row).toBeTruthy();
    expect(row.textContent).not.toContain(enMessages.profile.push.metaOff);
  });

  it('shows the state once the probe answers', async () => {
    push.status = 'off';
    signedInProfile();
    const row = (await screen.findByText(enMessages.profile.settings.notifications)).closest('button')!;
    expect(row.textContent).toContain(enMessages.profile.push.metaOff);
  });

  it('opens the Notifications page, which the shell owns', async () => {
    push.status = 'off';
    const open = vi.fn();
    signedInProfile(open);
    const row = (await screen.findByText(enMessages.profile.settings.notifications)).closest('button')!;
    row.click();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
