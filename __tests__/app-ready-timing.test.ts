// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/events/route';
import { computeClubMetrics } from '@/lib/metricsMath';
import { firstScreenReady, launchGone } from '@/lib/useUsageBeacons';
import { NextRequest, NextResponse } from 'next/server';
import { setMemberCookie } from '@/lib/auth';
import { resetMockStore, getStore, setupAdminPin } from './helpers';

/**
 * How long opening the app takes on members' real phones (docs/plans/
 * startup-speed.md; Grant, 2026-11-05: "this app is getting really slow").
 * One `app_ready` per open: numbers and bounded words, never content.
 */
type Row = Record<string, unknown>;
let ip = 0;
function postAs(body: unknown): NextRequest {
  const r = NextResponse.json({});
  setMemberCookie(r, 'm-lin', 'Lin');
  ip++;
  return new NextRequest(new URL('/api/events', 'http://localhost/bpm'), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-client-ip': `app-ready-${ip}`, cookie: `member_session=${r.cookies.get('member_session')!.value}` },
  });
}
const rows = () => (getStore()['events'] ?? []) as Row[];

describe('app_ready beacon', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('stores the two timings, how it started and the platform', async () => {
    const res = await POST(postAs({ kind: 'app_ready', ms: 1234.6, launchMs: 2011, start: 'open', platform: 'ios', url: '/x?join=abc', tab: 'home' }));
    expect(res.status).toBeLessThan(300);
    const row = rows().find((r) => r.kind === 'app_ready')!;
    expect(row).toMatchObject({ ms: 1235, launchMs: 2011, start: 'open', platform: 'ios' });
    expect(row).not.toHaveProperty('url');
    expect(row).not.toHaveProperty('tab');
  });

  it('drops a timing that is not a plausible load and a start it does not know', async () => {
    await POST(postAs({ kind: 'app_ready', ms: 999_999, launchMs: -5, start: 'warp' }));
    const row = rows().find((r) => r.kind === 'app_ready')!;
    expect(row).not.toHaveProperty('ms');
    expect(row).not.toHaveProperty('launchMs');
    expect(row).not.toHaveProperty('start');
  });
});

describe('appReady in club metrics', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const base = { now, sessionsShown: 8, sessions: [], players: [], kudos: [], stringingJobs: [], pushSubscriptions: [] };
  const roster = [{ memberId: 'a', name: 'Lin', joinedAt: '2026-01-01T00:00:00Z' }] as never;
  const at = '2026-11-05T00:00:00Z';

  it('gives the typical and the slow open over the last 7 days, roster only', () => {
    const m = computeClubMetrics({
      ...base,
      roster,
      timingEvents: [
        ...[900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 4000].map((ms) => ({ memberId: 'a', at, ms, launchMs: ms + 800, start: 'open' })),
        { memberId: 'a', at, ms: 300, start: 'return' },
        { memberId: 'a', at: '2026-10-01T00:00:00Z', ms: 9000 },
        { memberId: 'stranger', at, ms: 9000 },
      ],
    });
    expect(m.appReady.opens7d).toBe(11);
    expect(m.appReady.medianMs).toBe(1300);
    expect(m.appReady.slowMs).toBe(1700);
    expect(m.appReady.medianLaunchMs).toBe(2100);
    expect(m.appReady.byStart.open).toEqual({ opens: 10, medianMs: 1300 });
    expect(m.appReady.byStart.return).toEqual({ opens: 1, medianMs: null });
  });

  it('says nothing from too few opens rather than a number two opens made', () => {
    const m = computeClubMetrics({ ...base, roster, timingEvents: [{ memberId: 'a', at, ms: 800 }, { memberId: 'a', at, ms: 900 }] });
    expect(m.appReady).toMatchObject({ opens7d: 2, medianMs: null, slowMs: null });
  });
});

describe('when the first screen counts as ready', () => {
  const shell = (inner: string) => { document.body.innerHTML = `<main data-app-shell>${inner}</main>`; };

  it('needs a tab on screen with content and no loading line', () => {
    shell('<div data-tab-panel="home" hidden>Old content that is long enough</div>');
    expect(firstScreenReady(document)).toBe(false);
    shell('<div data-tab-panel="home">This week · Thursday 8 PM · 10 of 12 in</div>');
    expect(firstScreenReady(document)).toBe(true);
  });

  it('the launch screen counts as gone once done, lifted or never shown', () => {
    document.documentElement.dataset.launch = 'loading';
    expect(launchGone(document)).toBe(false);
    document.documentElement.dataset.launch = 'done';
    expect(launchGone(document)).toBe(true);
    delete document.documentElement.dataset.launch;
    expect(launchGone(document)).toBe(true);
  });
});
