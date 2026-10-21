// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { completeSignIn } from '@/lib/authSession';
import { setMemberCookie } from '@/lib/auth';
import { POST } from '@/app/api/events/route';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

/**
 * The usage records (docs/plans/usage-metrics.md): always on since their flag
 * retired on 2026-10-21, bounded in what they store, and never able to fail
 * the thing they record.
 */

const events = () => (getStore()['events'] ?? []) as Array<Record<string, unknown>>;

function memberCookie(memberId: string, name: string): string {
  const r = NextResponse.json({});
  setMemberCookie(r, memberId, name);
  return `member_session=${r.cookies.get('member_session')!.value}`;
}

let ip = 0;
function beacon(body: unknown, cookie: string, fixedIp?: string): NextRequest {
  ip++;
  return new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-client-ip': fixedIp ?? `usage-${ip}`, cookie },
  });
}

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
});
afterEach(() => {
  vi.doUnmock('@/lib/events');
  vi.restoreAllMocks();
});

describe('sign_in, written by completeSignIn', () => {
  it('records the method and the minted group', async () => {
    await completeSignIn(NextResponse.json({}), { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', 'google');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ memberId: 'm1', kind: 'sign_in', via: 'google', groupId: 'bpm' });
  });

  it('records nothing for a re-mint (via null)', async () => {
    await completeSignIn(NextResponse.json({}), { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', null);
    expect(events()).toHaveLength(0);
  });

  it('never fails the sign-in when the record cannot be written', async () => {
    vi.resetModules();
    vi.doMock('@/lib/events', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/events')>();
      return { ...mod, writeEvent: async () => { throw new Error('cosmos down'); } };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { completeSignIn: fresh } = await import('@/lib/authSession');
    const res = NextResponse.json({});
    await expect(fresh(res, { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', 'pin')).resolves.toBeUndefined();
    expect(res.cookies.get('member_session')).toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('app_open and tab_view, through POST /api/events', () => {
  it('records them with a bounded payload', async () => {
    const lin = memberCookie('m1', 'Lin');
    expect((await POST(beacon({ kind: 'app_open', platform: 'installed', url: '/bpm?join=secret' }, lin))).status).toBe(201);
    expect((await POST(beacon({ kind: 'tab_view', tab: 'skills' }, lin))).status).toBe(201);
    expect((await POST(beacon({ kind: 'tab_view', tab: 'admin' }, lin))).status).toBe(201);
    const [open, stats, admin] = events();
    expect(open).toMatchObject({ kind: 'app_open', platform: 'installed' });
    expect(open).not.toHaveProperty('url');
    expect(stats).toMatchObject({ kind: 'tab_view', tab: 'skills' });
    // A tab outside the list is dropped, not stored as free text.
    expect(admin).not.toHaveProperty('tab');
  });

  it('refuses sign_in from a client — it is a server kind', async () => {
    const res = await POST(beacon({ kind: 'sign_in', via: 'pin' }, memberCookie('m1', 'Lin')));
    expect(res.status).toBe(400);
  });

  it('limits one member across many addresses', async () => {
    const lin = memberCookie('m-flood', 'Lin');
    let limited = false;
    for (let i = 0; i < 130; i++) {
      const res = await POST(beacon({ kind: 'tab_view', tab: 'home' }, lin));
      if (res.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
    expect(events().length).toBeLessThanOrEqual(120);
  });
});
