// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { completeSignIn } from '@/lib/authSession';
import { setMemberCookie } from '@/lib/auth';
import { POST } from '@/app/api/events/route';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

/**
 * The usage records (docs/plans/usage-metrics.md): off by flag until the
 * store privacy labels say so, and never able to fail the thing they record.
 *
 * Both halves of the flag are pinned, because the OFF branch is what runs in
 * production today: a regression there would start recording before the
 * privacy text and the store labels allow it.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_USAGE_METRICS';
const before = process.env[FLAG];

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
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
  vi.doUnmock('@/lib/events');
  vi.restoreAllMocks();
});

describe('sign_in, written by completeSignIn', () => {
  it('records nothing with the flag off', async () => {
    process.env[FLAG] = 'false';
    await completeSignIn(NextResponse.json({}), { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', 'pin');
    expect(events()).toHaveLength(0);
  });

  it('records the method and the minted group with the flag on', async () => {
    process.env[FLAG] = 'true';
    await completeSignIn(NextResponse.json({}), { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', 'google');
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ memberId: 'm1', kind: 'sign_in', via: 'google', groupId: 'bpm' });
  });

  it('records nothing for a re-mint (via null)', async () => {
    process.env[FLAG] = 'true';
    await completeSignIn(NextResponse.json({}), { id: 'm1', name: 'Lin', role: 'member' }, 'bpm', null);
    expect(events()).toHaveLength(0);
  });

  it('never fails the sign-in when the record cannot be written', async () => {
    process.env[FLAG] = 'true';
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
  it('404s both with the flag off and writes nothing', async () => {
    process.env[FLAG] = 'false';
    const lin = memberCookie('m1', 'Lin');
    expect((await POST(beacon({ kind: 'app_open', platform: 'ios' }, lin))).status).toBe(404);
    expect((await POST(beacon({ kind: 'tab_view', tab: 'home' }, lin))).status).toBe(404);
    expect(events()).toHaveLength(0);
  });

  it('records them with a bounded payload when on', async () => {
    process.env[FLAG] = 'true';
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
    process.env[FLAG] = 'true';
    const res = await POST(beacon({ kind: 'sign_in', via: 'pin' }, memberCookie('m1', 'Lin')));
    expect(res.status).toBe(400);
  });

  it('limits one member across many addresses', async () => {
    process.env[FLAG] = 'true';
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
