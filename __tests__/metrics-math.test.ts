import { describe, it, expect } from 'vitest';
import { computeClubMetrics, median, type MetricsInput, type MetricsPlayer } from '@/lib/metricsMath';

/**
 * The club metrics are arithmetic an admin makes decisions from, so each
 * number is pinned against a fixture small enough to count by hand. The two
 * rules that would make the page quietly wrong get their own cases: a rate
 * with nothing to divide by is null (never 0%), and no name leaves the module.
 */

const NOW = new Date('2026-10-07T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function base(over: Partial<MetricsInput> = {}): MetricsInput {
  return {
    now: NOW,
    sessionsShown: 8,
    sessions: [],
    players: [],
    roster: [],
    kudos: [],
    stringingJobs: [],
    pushSubscriptions: [],
    ...over,
  };
}

const p = (sessionId: string, name: string, over: Partial<MetricsPlayer> = {}): MetricsPlayer => ({
  sessionId,
  name,
  ...over,
});

describe('median', () => {
  it('is null for nothing, the middle for odd, the mean of the middle two for even', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('computeClubMetrics', () => {
  it('reads a session: confirmed, waitlist, self-cancels, fill, sign-up speed', () => {
    const opened = '2026-10-01T18:00:00.000Z';
    const at = (min: number) => new Date(Date.parse(opened) + min * 60_000).toISOString();
    const m = computeClubMetrics(
      base({
        sessions: [{ id: 's1', datetime: '2026-10-02T19:00:00-07:00', maxPlayers: 3, signupOpenedAt: opened }],
        players: [
          p('s1', 'A', { timestamp: at(2) }),
          p('s1', 'B', { timestamp: at(4) }),
          p('s1', 'C', { timestamp: at(10), removed: true, cancelledBySelf: true }),
          p('s1', 'D', { timestamp: at(30) }),
          p('s1', 'E', { timestamp: at(60), waitlisted: true }),
          p('s1', 'F', { timestamp: at(90), removed: true, cancelledBySelf: false }),
        ],
      }),
    );
    expect(m.sessions).toEqual([
      {
        date: '2026-10-02',
        capacity: 3,
        confirmed: 3,
        waitlisted: 1,
        cancelledBySelf: 1,
        fillRate: 1,
        // Six taps at 2, 4, 10, 30, 60, 90 minutes.
        medianSignupMinutes: 20,
        // The third tap took the last spot.
        minutesToFill: 10,
      },
    ]);
  });

  it('leaves sign-up speed unknown when the open time was never recorded', () => {
    const m = computeClubMetrics(
      base({
        sessions: [{ id: 's1', datetime: '2026-10-02T19:00:00-07:00', maxPlayers: 2 }],
        players: [p('s1', 'A', { timestamp: daysAgo(6) })],
      }),
    );
    expect(m.sessions[0].medianSignupMinutes).toBeNull();
    expect(m.sessions[0].minutesToFill).toBeNull();
    expect(m.sessions[0].fillRate).toBe(0.5);
  });

  it('shows past sessions only, oldest first, capped at the requested count', () => {
    const sessions = [1, 2, 3, 4].map((w) => ({
      id: `s${w}`, datetime: daysAgo(7 * (5 - w)), maxPlayers: 10,
    }));
    sessions.push({ id: 'future', datetime: daysAgo(-3), maxPlayers: 10 });
    const m = computeClubMetrics(base({ sessionsShown: 3, sessions }));
    expect(m.sessions.map((s) => s.date)).toEqual([daysAgo(21), daysAgo(14), daysAgo(7)].map((d) => d.slice(0, 10)));
  });

  it('counts active members as distinct people in the last 4 sessions vs the 4 before', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, datetime: daysAgo(7 * (8 - i)), maxPlayers: 10 }));
    const players = [
      p('s0', 'Old'), p('s1', 'Old'), p('s3', 'Both'),
      p('s5', 'Both'), p('s6', 'New'), p('s7', 'New'),
      p('s7', 'Gone', { removed: true }), p('s7', 'Wait', { waitlisted: true }),
    ];
    const m = computeClubMetrics(base({ sessions, players }));
    expect(m.activeMembers).toEqual({ last4: 2, previous4: 2 });
  });

  it('keys a legacy row with no memberId to the roster member of that name', () => {
    const sessions = [{ id: 's1', datetime: daysAgo(14), maxPlayers: 10 }, { id: 's2', datetime: daysAgo(7), maxPlayers: 10 }];
    const m = computeClubMetrics(
      base({
        sessions,
        roster: [{ memberId: 'm-lin', name: 'Lin', joinedAt: daysAgo(100) }],
        players: [p('s1', 'lin '), p('s2', 'Lin', { memberId: 'm-lin' })],
      }),
    );
    expect(m.activeMembers.last4).toBe(1);
  });

  it('activation: joined 14–90 days ago and signed up within 14 days of joining', () => {
    const sessions = [{ id: 's1', datetime: daysAgo(30), maxPlayers: 10 }];
    const m = computeClubMetrics(
      base({
        sessions,
        roster: [
          { memberId: 'quick', name: 'Quick', joinedAt: daysAgo(40) },
          { memberId: 'slow', name: 'Slow', joinedAt: daysAgo(60) },
          { memberId: 'never', name: 'Never', joinedAt: daysAgo(50) },
          { memberId: 'fresh', name: 'Fresh', joinedAt: daysAgo(5) },
          { memberId: 'veteran', name: 'Veteran', joinedAt: daysAgo(400) },
        ],
        players: [
          p('s1', 'Quick', { memberId: 'quick', timestamp: daysAgo(35) }),
          p('s1', 'Slow', { memberId: 'slow', timestamp: daysAgo(31) }),
        ],
      }),
    );
    expect(m.newMembers).toEqual({ joined90d: 4, activationEligible: 3, activated14d: 1, activationRate: 1 / 3 });
  });

  it('activation rate is null, not 0%, when nobody is old enough to judge', () => {
    const m = computeClubMetrics(base({ roster: [{ memberId: 'x', name: 'X', joinedAt: daysAgo(3) }] }));
    expect(m.newMembers.activationRate).toBeNull();
  });

  it('retention: monthly cohorts by first session, null for a month not yet over', () => {
    const s = (id: string, datetime: string) => ({ id, datetime, maxPlayers: 10 });
    const sessions = [
      s('jul', '2026-07-09T19:00:00-07:00'),
      s('aug', '2026-08-13T19:00:00-07:00'),
      s('sep', '2026-09-10T19:00:00-07:00'),
      s('oct', '2026-10-01T19:00:00-07:00'),
    ];
    const players = [
      p('jul', 'A'), p('jul', 'B'),
      p('aug', 'A'), p('aug', 'C'),
      p('sep', 'B'), p('sep', 'C'),
      p('oct', 'D'),
    ];
    const m = computeClubMetrics(base({ sessions, players }));
    expect(m.retention).toEqual([
      // A came back in Aug, B in Sep; October is not over, so it is not a zero.
      { cohort: '2026-07', size: 2, returned: [0.5, 0.5, null] },
      { cohort: '2026-08', size: 1, returned: [1, null, null] },
    ]);
    // October's cohort (D) is this month and has nothing to return to yet.
  });

  it('feature adoption counts roster members only, within 28 days', () => {
    const roster = ['a', 'b', 'c', 'd'].map((id) => ({ memberId: id, name: id.toUpperCase() }));
    const m = computeClubMetrics(
      base({
        roster,
        kudos: [
          { raterMemberId: 'a', createdAt: daysAgo(1) },
          { raterMemberId: 'a', createdAt: daysAgo(2) },
          { raterMemberId: 'b', createdAt: daysAgo(40) },
          { raterMemberId: 'other-club', createdAt: daysAgo(1) },
        ],
        stringingJobs: [{ memberId: 'c', createdAt: daysAgo(10) }],
        pushSubscriptions: [{ memberId: 'a' }, { memberId: 'a' }, { memberId: 'd' }, { memberId: 'other-club' }],
      }),
    );
    expect(m.features).toEqual({
      kudosGivers28d: 1,
      stringingRequesters28d: 1,
      pushEnabled: 2,
      kudosShare: 0.25,
      stringingShare: 0.25,
      pushShare: 0.5,
    });
  });

  it('payments: settled lines, paid share, days from settle to paid', () => {
    const settledAt = daysAgo(20);
    const after = (d: number) => new Date(Date.parse(settledAt) + d * DAY).toISOString();
    const m = computeClubMetrics(
      base({
        sessions: [
          { id: 's1', datetime: daysAgo(21), maxPlayers: 10, settledAt },
          { id: 's2', datetime: daysAgo(14), maxPlayers: 10 }, // not settled: no lines
        ],
        players: [
          p('s1', 'A', { paid: true, paidAt: after(1) }),
          p('s1', 'B', { paid: true, paidAt: after(9) }),
          p('s1', 'C', { paid: true }), // legacy: paid, time unknown
          p('s1', 'D'),
          p('s1', 'E', { writtenOff: true }),
          p('s1', 'F', { waitlisted: true }),
          p('s1', 'G', { paid: true, paidAt: after(-1) }), // paid before the bill froze
          p('s2', 'H'),
        ],
      }),
    );
    expect(m.payments).toEqual({
      settledLines: 5,
      paidLines: 4,
      paidRate: 0.8,
      timedLines: 3,
      medianDaysToPay: 1,
      paidWithin7dRate: 2 / 3,
    });
  });

  it('every rate is null on an empty club', () => {
    const m = computeClubMetrics(base());
    expect(m.newMembers.activationRate).toBeNull();
    expect(m.features.kudosShare).toBeNull();
    expect(m.payments.paidRate).toBeNull();
    expect(m.payments.medianDaysToPay).toBeNull();
    expect(m.sessions).toEqual([]);
    expect(m.retention).toEqual([]);
  });

  it('returns no names and no member ids — totals only', () => {
    const sessions = [{ id: 's1', datetime: daysAgo(30), maxPlayers: 10, signupOpenedAt: daysAgo(32), settledAt: daysAgo(29) }];
    const m = computeClubMetrics(
      base({
        sessions,
        roster: [{ memberId: 'member-zq81', name: 'Zhiqiang', joinedAt: daysAgo(45) }],
        players: [p('s1', 'Zhiqiang', { memberId: 'member-zq81', timestamp: daysAgo(31), paid: true, paidAt: daysAgo(28) })],
        kudos: [{ raterMemberId: 'member-zq81', createdAt: daysAgo(1) }],
        pushSubscriptions: [{ memberId: 'member-zq81' }],
      }),
    );
    const out = JSON.stringify(m);
    expect(out).not.toMatch(/zhiqiang/i);
    expect(out).not.toContain('member-zq81');
  });
});
