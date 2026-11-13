// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import JoinGroupPage from '@/components/onboarding/JoinGroupPage';

/**
 * docs/plans/one-way-in.md, step 1. What a signed-in member sees when the
 * link they opened will not take them in.
 *
 * - A LINK that no longer resolves said "That code doesn't work", about a
 *   code they never typed.
 * - Another club's DOOR link resolved ("Join {club}?") and the Join button
 *   then always failed, because `POST /api/groups/join` claims only one-time
 *   invites. Until joining through a door with an existing account is built
 *   (step 4), the page says what does work instead of offering that button.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderWithLink(token: string) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <JoinGroupPage onBack={vi.fn()} sessionId="" initialToken={token} defaultName="Lin" />
    </NextIntlClientProvider>,
  );
}

describe('JoinGroupPage — links that cannot take you in', () => {
  it("another club's door link explains what to ask for, and offers no Join button", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ name: 'Six Feathers', kind: 'door' }) : json({}),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithLink('a1'.repeat(16));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/ask Six Feathers's organiser for an invite link/);
    expect(screen.queryByRole('button', { name: /Join Six Feathers/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/groups/join'))).toBe(false);
  });

  it('a link that no longer resolves says the link no longer works', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ error: 'invite_not_found' }, 404) : json({}),
    ));
    renderWithLink('b2'.repeat(16));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/That link no longer works/);
    expect(alert.textContent).not.toMatch(/code/);
  });

  it('an invite link still opens the join step', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/groups/preview') ? json({ name: 'Six Feathers', kind: 'invite' }) : json({}),
    ));
    renderWithLink('c3'.repeat(16));
    expect(await screen.findByRole('button', { name: /Join Six Feathers/ })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
