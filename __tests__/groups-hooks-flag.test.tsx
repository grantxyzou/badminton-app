// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useCurrentGroup } from '../lib/useCurrentGroup';
import { useInviteLink } from '../lib/useInviteLink';

// With the multi-group flag off, every `/api/groups/*` route 404s by design.
// The hooks used to ask anyway, and six mounted consumers turned that into a
// wall of red 404s in every member's console. Flag off must mean no request.

const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';
const MEMBERS_ONLY = 'NEXT_PUBLIC_FLAG_MEMBERS_ONLY';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('group hooks and the multi-group flag', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Lin', sessionId: 's1' }));
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/groups/current')) {
        return jsonResponse({ id: 'bpm', name: 'BPM', role: 'member', rosterName: 'Lin', isOwner: false, memberCount: 6 });
      }
      if (url.endsWith('/api/groups/mine')) return jsonResponse({ groups: [] });
      if (url.endsWith('/api/groups/invite')) return jsonResponse({ token: 't', code: 'ABCDEFGH', createdAt: '2026-09-13' });
      return jsonResponse({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    delete process.env[FLAG];
    delete process.env[MEMBERS_ONLY];
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('useCurrentGroup: flag off makes no request and resolves to no group', async () => {
    process.env[FLAG] = 'false';
    const { result } = renderHook(() => useCurrentGroup());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.group).toBeNull();
    expect(result.current.error).toBe(false);
  });

  it('useCurrentGroup: flag on with an identity asks both endpoints', async () => {
    process.env[FLAG] = 'true';
    const { result } = renderHook(() => useCurrentGroup());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/api/groups/current'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/api/groups/mine'))).toBe(true);
    expect(result.current.group?.id).toBe('bpm');
  });

  it('useInviteLink: both flags off makes no request', async () => {
    process.env[FLAG] = 'false';
    process.env[MEMBERS_ONLY] = 'false';
    const { result } = renderHook(() => useInviteLink());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.invite).toBeNull();
    expect(result.current.error).toBe(false);
  });

  it('useInviteLink: flag on asks for the invite', async () => {
    process.env[FLAG] = 'true';
    const { result } = renderHook(() => useInviteLink());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/groups/invite'))).toBe(true);
    expect(result.current.invite?.code).toBe('ABCDEFGH');
  });

  /**
   * PRODUCTION, 2026-10-06: members-only ON, multi-group OFF. The server opens
   * `groups/invite` under either flag (`invitesOn` in lib/groupRoutes.ts),
   * because with members-only on a new account can only be made with an
   * invite — so the admin has to be able to hand one out. This hook kept its
   * own older rule (multi-group alone), so the admin's Invite card showed no
   * link and "Share sign-up link" shared the bare app address. A new person
   * who opened it was asked for an invite code nobody could give them.
   */
  it('useInviteLink: members-only alone asks for the invite, as the server allows', async () => {
    process.env[FLAG] = 'false';
    process.env[MEMBERS_ONLY] = 'true';
    const { result } = renderHook(() => useInviteLink());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/api/groups/invite'))).toBe(true);
    expect(result.current.invite?.code).toBe('ABCDEFGH');
    expect(result.current.url).toContain('?join=t');
  });
});
