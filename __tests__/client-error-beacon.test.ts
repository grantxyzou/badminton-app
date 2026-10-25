// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/events/route';
import { computeClubMetrics } from '@/lib/metricsMath';
import { NextRequest, NextResponse } from 'next/server';
import { setMemberCookie } from '@/lib/auth';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

type Row = Record<string, unknown>;
let ip = 0;
function postAs(body: unknown): NextRequest {
  const r = NextResponse.json({});
  setMemberCookie(r, 'm-lin', 'Lin');
  ip++;
  return new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-client-ip': `client-error-${ip}`, cookie: `member_session=${r.cookies.get('member_session')!.value}` },
  });
}

/**
 * docs/plans/client-error-beacon.md. The beacon may only say WHERE a screen
 * broke, from a bounded list — never a message, a stack or a URL.
 */
describe('client_error beacon', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('stores a bounded where + tab and drops anything free-text', async () => {
    const res = await POST(
      postAs({ kind: 'client_error', where: 'render', tab: 'home', message: 'secret stack', url: '/x?invite=abc' }),
    );
    expect(res.status).toBe(201);
    const row = getStore()['events'][0] as Row;
    expect(row).toMatchObject({ kind: 'client_error', where: 'render', tab: 'home' });
    expect(row.message).toBeUndefined();
    expect(row.url).toBeUndefined();
  });

  it('rejects an unknown where by dropping it', async () => {
    await POST(postAs({ kind: 'client_error', where: '<script>' }));
    expect((getStore()['events'][0] as Row).where).toBeUndefined();
  });
});

describe('clientErrors in club metrics', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const base = { now, sessionsShown: 8, sessions: [], players: [], kudos: [], stringingJobs: [], pushSubscriptions: [] };
  const roster = [{ memberId: 'a', name: 'Lin', joinedAt: '2026-01-01T00:00:00Z' }] as never;

  it('counts roster members in the last 7 days only, by tab', () => {
    const m = computeClubMetrics({
      ...base,
      roster,
      errorEvents: [
        { memberId: 'a', at: '2026-10-23T00:00:00Z', tab: 'home' },
        { memberId: 'a', at: '2026-10-22T00:00:00Z' },
        { memberId: 'a', at: '2026-10-01T00:00:00Z', tab: 'home' },
        { memberId: 'stranger', at: '2026-10-23T00:00:00Z', tab: 'home' },
      ],
    });
    expect(m.clientErrors).toEqual({ last7d: 2, members7d: 1, byTab: { home: 1, unknown: 1 } });
  });

  it('is a real zero when nothing crashed', () => {
    expect(computeClubMetrics({ ...base, roster }).clientErrors).toEqual({ last7d: 0, members7d: 0, byTab: {} });
  });
});
