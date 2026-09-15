import { describe, it, expect } from 'vitest';
import { lastStrungFromJobs, lastStrungAt, weeksSince, restringState } from '../lib/restring';

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

describe('lastStrungAt', () => {
  const entry = (at: string, stringItemId = 's1') => ({ at, catalogId: null, stringItemId });

  it('does not treat putting a string in the bag as a restring', () => {
    // Logging a six-month-old bed today must not read "last strung this week".
    expect(lastStrungAt(null, [entry('2026-09-14T00:00:00Z')])).toBeNull();
    expect(lastStrungAt(null, [entry('2026-09-01T00:00:00Z', 's1'), entry('2026-09-02T00:00:00Z', 's2')])).toBeNull();
  });

  it('counts a later tension change on a string already in the bag', () => {
    const log = [entry('2026-06-01T00:00:00Z'), entry('2026-08-01T00:00:00Z')];
    expect(lastStrungAt(null, log)).toBe('2026-08-01T00:00:00Z');
  });

  it('prefers whichever is later, the shop or the member’s own restrings', () => {
    const log = [entry('2026-06-01T00:00:00Z'), entry('2026-08-01T00:00:00Z')];
    expect(lastStrungAt('2026-07-01T00:00:00Z', log)).toBe('2026-08-01T00:00:00Z');
    expect(lastStrungAt('2026-09-01T00:00:00Z', log)).toBe('2026-09-01T00:00:00Z');
  });

  it('is null with neither, and skips unparseable dates', () => {
    expect(lastStrungAt(null, undefined)).toBeNull();
    expect(lastStrungAt(null, [entry('2026-06-01T00:00:00Z'), entry('Sunday')])).toBeNull();
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

describe('restringState', () => {
  it('is null with no date — unknown is never "due"', () => {
    expect(restringState(null, new Date())).toBeNull();
  });
});
