// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import ProfileTab from '../../components/ProfileTab';
import enMessages from '../../messages/en.json';

/**
 * Loading cascade, phase 4. ProfileTab reads the stored identity in an effect,
 * and its state used to START as `null` — "signed out" — so a signed-in
 * member's first frame was the anonymous "Welcome back" sign-in card. The
 * first frame is the loading frame now.
 *
 * `renderToString` is the only way to look at that frame: it runs no effects,
 * whereas `render` flushes them before the test can see anything.
 */
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Profile first frame', () => {
  it('is the loading frame, not the signed-out card, while the identity is unread', () => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Michael', token: 't', sessionId: 's' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <ProfileTab sessionId="s" sessionLabel="Apr 27" isAdmin={false} onAdminTools={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).not.toContain(enMessages.profile.anonymousTitle);
    expect(html).toContain('aria-label="Loading"');
  });
});
