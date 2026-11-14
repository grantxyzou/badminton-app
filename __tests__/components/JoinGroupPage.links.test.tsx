// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it("another club's link asks to join, as this account, and says an organiser decides", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/groups/preview')) return json({ name: 'Six Feathers', kind: 'door' });
      if (url.includes('/api/groups/ask')) return json({ ok: true, groupId: 'club-x', club: 'Six Feathers' });
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);
    const onAsked = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <JoinGroupPage onBack={vi.fn()} sessionId="" initialToken={'a1'.repeat(16)} defaultName="Lin" onAsked={onAsked} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Ask to join Six Feathers' }));
    expect(await screen.findByText('Asked to join Six Feathers')).toBeDefined();
    const ask = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/groups/ask'))!;
    expect(JSON.parse(String((ask[1] as RequestInit).body))).toEqual({ doorToken: 'a1'.repeat(16), name: 'Lin' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onAsked).toHaveBeenCalled();
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

  it('a typed code asks for the link: one-time invites were retired (one-way-in step 5)', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <JoinGroupPage onBack={vi.fn()} sessionId="" defaultName="Lin" />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("The club's link"), { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Paste the whole link/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
