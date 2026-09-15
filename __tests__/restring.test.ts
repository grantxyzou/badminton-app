import { describe, it, expect } from 'vitest';
import { lastStrungFromJobs, weeksSince, restringDueWeeks, RESTRING_AFTER_WEEKS } from '../lib/restring';

describe('lastStrungFromJobs', () => {
  it('takes the latest ready or picked_up step across jobs', () => {
    expect(lastStrungFromJobs([
      { history: [{ status: 'ready', at: '2026-03-01T00:00:00Z', by: null }] },
      { history: [
        { status: 'ready', at: '2026-05-01T00:00:00Z', by: null },
        { status: 'picked_up', at: '2026-05-03T00:00:00Z', by: null },
      ] },
    ])).toBe('2026-05-03T00:00:00Z');
  });

  it('ignores steps before the racket was strung', () => {
    expect(lastStrungFromJobs([
      { history: [
        { status: 'requested', at: '2026-09-10T00:00:00Z', by: null },
        { status: 'received', at: '2026-09-11T00:00:00Z', by: null },
      ] },
    ])).toBeNull();
  });
});

describe('weeksSince', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  it('counts whole weeks and never goes negative', () => {
    expect(weeksSince('2026-09-08T12:00:00Z', now)).toBe(0);
    expect(weeksSince('2026-09-07T12:00:00Z', now)).toBe(1);
    expect(weeksSince('2026-09-20T12:00:00Z', now)).toBe(0);
  });
});

describe('restringDueWeeks', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const weeksBefore = (n: number) => new Date(now.getTime() - n * 7 * 24 * 60 * 60 * 1000).toISOString();

  it('is two months', () => {
    expect(RESTRING_AFTER_WEEKS).toBe(8);
  });

  it('says nothing the week before, and speaks on the day', () => {
    expect(restringDueWeeks(weeksBefore(RESTRING_AFTER_WEEKS), now)).toBe(8);
    expect(restringDueWeeks(new Date(Date.parse(weeksBefore(8)) + 1000).toISOString(), now)).toBeNull();
    expect(restringDueWeeks(weeksBefore(20), now)).toBe(20);
  });

  it('is null with no date or an unreadable one — never due on a guess', () => {
    expect(restringDueWeeks(null, now)).toBeNull();
    expect(restringDueWeeks('Sunday', now)).toBeNull();
  });
});
