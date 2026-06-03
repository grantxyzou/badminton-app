// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import enMessages from '../../messages/en.json';

/**
 * Audit silent-failure cluster: ProfileTab chained members/me -> players in one
 * promise with a single catch. A players-fetch REJECTION (after members/me
 * already set pinIsSet=true) hit that catch and reset pinIsSet to null, wiping
 * the PIN status that loaded fine — so a user who HAS a PIN saw the generic
 * "Recovery PIN" label instead of "Update PIN". The two fetches must be
 * independent so a players failure can't clobber PIN status.
 */
const originalFetch = global.fetch;
const baseProps = { sessionId: 'session-2026-04-27', sessionLabel: 'Apr 27', isAdmin: false, onAdminTools: vi.fn() };

describe('ProfileTab — players-fetch failure must not wipe PIN status', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      'badminton_identity',
      JSON.stringify({ name: 'Michael', token: 'tok', sessionId: 'session-2026-04-27' }),
    );
  });
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('keeps "Update PIN" when members/me says hasPin but the players fetch rejects', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/members/me')) {
        return new Response(JSON.stringify({ hasPin: true, createdAt: '2026-01-01' }), { status: 200 });
      }
      if (url.includes('/api/players')) {
        throw new Error('network down'); // chained fetch rejects
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab {...baseProps} />
      </NextIntlClientProvider>,
    );

    // Let the members/me -> players chain fully settle (resolve + reject).
    await new Promise((r) => setTimeout(r, 120));

    // PIN status must survive: the row reads "Update PIN" (hasPin), NOT the
    // generic "Recovery PIN" fallback that the wiped (null) state produces.
    expect(screen.getByText(enMessages.profile.settings.updatePin)).toBeTruthy();
    expect(screen.queryByText(enMessages.profile.pinSectionTitle)).toBeNull();
  });
});
