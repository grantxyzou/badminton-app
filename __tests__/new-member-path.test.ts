import { describe, it, expect } from 'vitest';
import { computeNewMemberPath, USAGE_RECORDED_FROM } from '../lib/metricsMath';
import type { MetricsInput } from '../lib/metricsMath';

/**
 * docs/plans/new-member-path.md (Grant, 2026-11-12: "two people joined the
 * group … what was their path"): of those who joined lately, how many reached
 * each step. Counts only.
 */

const NOW = new Date('2026-11-12T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function input(over: Partial<Pick<MetricsInput, 'roster' | 'sessions' | 'players' | 'journeyEvents'>> = {}) {
  return {
    now: NOW,
    roster: [
      { memberId: 'akane', name: 'Akane', joinedAt: day(5), joinedVia: 'admin', claimed: true },
      { memberId: 'kento', name: 'Kento', joinedAt: day(3), joinedVia: 'link', claimed: false },
      // Joined before usage tracking began: left out, or "never opened" would be a guess.
      { memberId: 'lin', name: 'Lin', joinedAt: '2026-09-01T00:00:00.000Z', joinedVia: 'admin', claimed: true },
    ],
    sessions: [
      { id: 's-old', datetime: day(20), maxPlayers: 12 },
      { id: 's-past', datetime: day(1), maxPlayers: 12 },
      { id: 's-next', datetime: new Date(NOW.getTime() + 6 * 86_400_000).toISOString(), maxPlayers: 12 },
    ],
    players: [
      { sessionId: 's-past', name: 'Akane', memberId: 'akane', timestamp: day(4), paid: true },
      { sessionId: 's-next', name: 'Kento', memberId: 'kento', timestamp: day(2), waitlisted: true },
      // A row from before they joined: not part of their path here.
      { sessionId: 's-old', name: 'Kento', memberId: 'kento', timestamp: day(21), paid: true },
      { sessionId: 's-past', name: 'Lin', memberId: 'lin', timestamp: day(4), paid: true },
    ],
    journeyEvents: [
      { memberId: 'akane', kind: 'app_open', at: day(5) },
      { memberId: 'akane', kind: 'tab_view', at: day(5), tab: 'home' },
      { memberId: 'akane', kind: 'tab_view', at: day(4), tab: 'profile' },
      { memberId: 'kento', kind: 'tab_view', at: day(3), tab: 'home' },
      // Before Kento joined (another club's history): ignored.
      { memberId: 'kento', kind: 'tab_view', at: day(10), tab: 'stringing' },
      { memberId: 'lin', kind: 'tab_view', at: day(1), tab: 'stringing' },
    ],
    ...over,
  };
}

describe('computeNewMemberPath', () => {
  it('counts each step over the people who joined since tracking began', () => {
    const p = computeNewMemberPath(input());
    expect(p.joined).toBe(2);
    expect(p.joinedVia).toEqual({ invite: 1, organiser: 1, created: 0, unrecorded: 0 });
    expect(p.keptAccount).toBe(1);
    expect(p.openedApp).toBe(2);
    expect(p.lookedAround).toBe(1);
    expect(p.signedUp).toBe(2);
    expect(p.played).toBe(1); // Kento is waiting on a session that has not happened
    expect(p.paid).toBe(1);
    expect(p.tabs).toEqual({ home: 2, stringing: 0, skills: 0, profile: 1 });
    // Akane: 1 day from joining to signing up; Kento: 1 day.
    expect(p.medianDaysToFirstSignup).toBe(1);
  });

  it('starts at the day tracking began when that is later than 90 days ago', () => {
    expect(computeNewMemberPath(input()).since).toBe(new Date(USAGE_RECORDED_FROM).toISOString());
    const later = { ...input(), now: new Date('2027-06-01T00:00:00.000Z') };
    expect(computeNewMemberPath(later).since).toBe(new Date(Date.parse('2027-06-01T00:00:00.000Z') - 90 * 86_400_000).toISOString());
  });

  it('answers "nobody yet" as zero people and no typical wait, never a guess', () => {
    const p = computeNewMemberPath(input({ roster: [] }));
    expect(p.joined).toBe(0);
    expect(p.signedUp).toBe(0);
    expect(p.medianDaysToFirstSignup).toBeNull();
  });
});
