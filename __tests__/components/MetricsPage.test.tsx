// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import MetricsPage from '@/components/admin/MetricsPage';
import type { ClubMetrics } from '@/lib/metricsMath';

/**
 * Admin → Metrics. The arithmetic is pinned in metrics-math.test.ts; this
 * pins what the page does with it: numbers render, a null is a dash and never
 * a zero, a failed load says so and can be retried, the range refetches, and
 * the not-yet-tracked card shows no numbers at all.
 */

const originalFetch = global.fetch;
const calls: string[] = [];

function mockMetrics(payload: unknown, ok = true) {
  calls.length = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(typeof input === 'string' ? input : (input as Request).url);
    if (!ok) return new Response('err', { status: 503 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

const HAPPY: ClubMetrics = {
  generatedAt: '2026-10-07T12:00:00.000Z',
  rosterSize: 40,
  activeMembers: { last4: 23, previous4: 19 },
  sessions: [
    {
      date: '2026-10-02',
      capacity: 12,
      confirmed: 12,
      waitlisted: 3,
      cancelledBySelf: 1,
      fillRate: 1,
      medianSignupMinutes: 20,
      minutesToFill: 190,
    },
  ],
  newMembers: { joined90d: 5, activationEligible: 4, activated14d: 3, activationRate: 0.75 },
  retention: [{ cohort: '2026-07', size: 4, returned: [0.5, 0.25, null] }],
  features: {
    kudosGivers28d: 8,
    stringingRequesters28d: 2,
    pushEnabled: 20,
    kudosShare: 0.2,
    stringingShare: 0.05,
    pushShare: 0.5,
  },
  payments: {
    settledLines: 10,
    paidLines: 9,
    paidRate: 0.9,
    timedLines: 6,
    medianDaysToPay: 1,
    paidWithin7dRate: 5 / 6,
  },
  usage: {
    firstRecordedAt: null,
    weeklyActive: [null, null, null, null],
    activeSoFar: null,
    avgDailyActive: null,
    stickiness: null,
    opensPerActive7d: null,
    tabViews: null,
    signInMethods: null,
  },
};

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('<MetricsPage />', () => {
  it('renders the club totals', async () => {
    mockMetrics(HAPPY);
    render(<MetricsPage onBack={() => {}} />);
    const active = await screen.findByRole('region', { name: 'Active members' });
    expect(within(active).getByText('23')).toBeTruthy();
    expect(within(active).getByText('19')).toBeTruthy();
    const sessions = screen.getByRole('region', { name: 'Sessions' });
    expect(within(sessions).getByText('12 / 12')).toBeTruthy();
    expect(within(sessions).getByText(/3 waitlisted · 1 cancelled · full in 3 h 10 min/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'New members' })).getByText('75%')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Features' })).getByText('8 · 20%')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Payments' })).getByText('90%')).toBeTruthy();
    expect(calls[0]).toContain('/api/admin/metrics?sessions=8');
  });

  it('writes a metric with nothing to measure as a dash, never 0', async () => {
    mockMetrics({
      ...HAPPY,
      newMembers: { joined90d: 0, activationEligible: 0, activated14d: 0, activationRate: null },
      payments: { settledLines: 0, paidLines: 0, paidRate: null, timedLines: 0, medianDaysToPay: null, paidWithin7dRate: null },
      retention: [],
    });
    render(<MetricsPage onBack={() => {}} />);
    const pay = await screen.findByRole('region', { name: 'Payments' });
    expect(within(pay).getAllByText('—')).toHaveLength(3);
    expect(within(pay).queryByText('0%')).toBeNull();
    const members = screen.getByRole('region', { name: 'New members' });
    expect(within(members).getByText('—')).toBeTruthy();
    expect(within(members).getByText(/Nobody joined long enough ago/)).toBeTruthy();
    expect(within(members).getByText(/Needs a full month of play/)).toBeTruthy();
  });

  it('says a failed load failed, and retries', async () => {
    mockMetrics(null, false);
    render(<MetricsPage onBack={() => {}} />);
    expect(await screen.findByText("Couldn't load the metrics.")).toBeTruthy();
    mockMetrics(HAPPY);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Active members' })).toBeTruthy();
  });

  it('refetches when the range changes, keeping the page on screen', async () => {
    mockMetrics(HAPPY);
    render(<MetricsPage onBack={() => {}} />);
    await screen.findByRole('region', { name: 'Sessions' });
    fireEvent.click(screen.getByRole('tab', { name: 'Last 12 sessions' }));
    await waitFor(() => expect(calls.at(-1)).toContain('sessions=12'));
    expect(screen.getByRole('region', { name: 'Sessions' })).toBeTruthy();
  });

  it('shows app usage once there are records', async () => {
    mockMetrics({
      ...HAPPY,
      usage: {
        firstRecordedAt: '2026-09-20T10:00:00.000Z',
        weeklyActive: [null, 14, 17, 19],
        activeSoFar: 24,
        avgDailyActive: 6.4,
        stickiness: 0.27,
        opensPerActive7d: 3.2,
        tabViews: { home: 60, skills: 30, profile: 10 },
        signInMethods: { pin: 9, google: 3 },
      },
    });
    render(<MetricsPage onBack={() => {}} />);
    const usage = await screen.findByRole('region', { name: 'Usage' });
    expect(within(usage).getByText('19')).toBeTruthy();
    expect(within(usage).getByText('6.4')).toBeTruthy();
    expect(within(usage).getByText('27%')).toBeTruthy();
    expect(within(usage).getByText('60 · 60%')).toBeTruthy();
    expect(within(usage).getByText(/PIN 9 · Google 3/)).toBeTruthy();
    expect(within(usage).getByText(/Recorded since Sep 20/)).toBeTruthy();
  });

  it('names the tracking-based numbers without drawing any', async () => {
    mockMetrics(HAPPY);
    render(<MetricsPage onBack={() => {}} />);
    const usage = await screen.findByRole('region', { name: 'Usage' });
    expect(within(usage).getByText('Starts when usage tracking is on')).toBeTruthy();
    expect(usage.textContent).not.toMatch(/\d/);
  });
});
