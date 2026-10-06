// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import InviteCard from '../../components/admin/CommandCenter/InviteCard';
import enMessages from '../../messages/en.json';

/**
 * The admin's Invite card for ONE-TIME invites (docs/plans/one-time-invites.md):
 * create a link for a person, see it in full to send, and see what is still
 * waiting. A failed load is a failure with a way out, not a dead end.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const A = { id: 'invite:a', token: 'a'.repeat(32), code: 'AAAABBBB', createdAt: '2026-10-05T10:00:00Z', expiresAt: '2026-10-12T10:00:00Z' };
const B = { id: 'invite:b', token: 'b'.repeat(32), code: 'CCCCDDDD', createdAt: '2026-10-06T10:00:00Z', expiresAt: '2026-10-13T10:00:00Z' };
const NEW = { id: 'invite:n', token: 'c'.repeat(32), code: 'EEEEFFFF', createdAt: '2026-10-06T12:00:00Z', expiresAt: '2026-10-13T12:00:00Z' };

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <InviteCard />
    </NextIntlClientProvider>,
  );
}

describe('InviteCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    cleanup();
    delete process.env[FLAG];
    vi.unstubAllGlobals();
  });

  it('shows the error with Try again, and Try again re-fetches', async () => {
    fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))
      .mockResolvedValue(jsonResponse({ invites: [B] }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Couldn't load the invites/);
    expect(screen.queryByText(/CCCC/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText(/CCCC/)).toBeDefined());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the newest live invite in full and the rest as a waiting list', async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ invites: [B, A] }));
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(await screen.findByText(/CCCC DDDD/)).toBeDefined();
    expect(screen.getByText(/\?join=bbbb/)).toBeDefined();
    expect(screen.getByText(/1 more waiting/)).toBeDefined();
    expect(screen.getByText(/AAAA BBBB/)).toBeDefined();
    expect(screen.getByText(/Works once, until/)).toBeDefined();
  });

  it('Create an invite posts, and the new one is shown in full', async () => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? jsonResponse(NEW, 201) : jsonResponse({ invites: [] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    expect(await screen.findByText(/No invites waiting/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }));
    expect(await screen.findByText(/EEEE FFFF/)).toBeDefined();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true);
  });

  it('Revoke deletes by id and drops it from the card', async () => {
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? jsonResponse({ ok: true }) : jsonResponse({ invites: [B] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await screen.findByText(/CCCC DDDD/);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByText(/CCCC DDDD/)).toBeNull());
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')!;
    expect(JSON.parse(String((del[1] as RequestInit).body))).toEqual({ id: 'invite:b' });
    expect(await screen.findByText(/No invites waiting/)).toBeDefined();
  });
});
