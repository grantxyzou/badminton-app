import { describe, it, expect } from 'vitest';
import {
  membersFirstEnd,
  membersFirstOpen,
  membersFirstDue,
  isMembersFirst,
  DEFAULT_MEMBERS_FIRST,
} from '@/lib/membersFirst';

/**
 * The members-first window's clock (lib/membersFirst.ts,
 * docs/plans/members-first-window.md). "5 days before at 23:59" is a wall
 * time on the club's clock (Vancouver), whatever daylight saving does between.
 */
describe('membersFirstEnd', () => {
  it('a Saturday evening session with Six Feathers’ rule ends Monday 11:59 PM', () => {
    expect(membersFirstEnd('2026-11-14T19:00:00-08:00', DEFAULT_MEMBERS_FIRST)).toBe('2026-11-10T07:59:00.000Z');
  });

  it('keeps the wall time across a daylight-saving change', () => {
    // Clocks fall back on Sun 1 Nov 2026: a PST session, a PDT cutoff.
    expect(membersFirstEnd('2026-11-07T19:00:00-08:00', { daysBefore: 6, time: '20:00' })).toBe('2026-11-02T04:00:00.000Z');
    // Clocks spring forward on Sun 8 Mar 2026: a PDT session, a PST cutoff.
    expect(membersFirstEnd('2026-03-14T19:00:00-07:00', { daysBefore: 6, time: '23:59' })).toBe('2026-03-09T06:59:00.000Z');
  });

  it('counts days on the club’s calendar, not the server’s', () => {
    // 11 PM Pacific on Friday is already Saturday in UTC.
    expect(membersFirstEnd('2026-11-14T07:00:00.000Z', { daysBefore: 1, time: '12:00' })).toBe('2026-11-12T20:00:00.000Z');
  });

  it('answers null for a missing rule or start', () => {
    expect(membersFirstEnd(undefined, DEFAULT_MEMBERS_FIRST)).toBeNull();
    expect(membersFirstEnd('not a date', DEFAULT_MEMBERS_FIRST)).toBeNull();
    expect(membersFirstEnd('2026-11-14T19:00:00-08:00', undefined)).toBeNull();
    expect(membersFirstEnd('2026-11-14T19:00:00-08:00', { daysBefore: 9, time: '23:59' })).toBeNull();
  });
});

describe('open and due', () => {
  const session = { datetime: '2026-11-14T19:00:00-08:00', membersFirst: DEFAULT_MEMBERS_FIRST };
  const end = Date.parse('2026-11-10T07:59:00.000Z');
  const start = Date.parse(session.datetime);

  it('is open until the end, then due until the session starts', () => {
    expect(membersFirstOpen(session, end - 1)).toBe(true);
    expect(membersFirstDue(session, end - 1)).toBe(false);
    expect(membersFirstOpen(session, end)).toBe(false);
    expect(membersFirstDue(session, end)).toBe(true);
    expect(membersFirstDue(session, start)).toBe(false);
  });

  it('is neither once the waitlist was let in, nor on a settled session, nor without a rule', () => {
    const released = { ...session, membersFirstReleasedAt: '2026-11-09T00:00:00.000Z' };
    expect(membersFirstOpen(released, end - 1)).toBe(false);
    expect(membersFirstDue(released, end)).toBe(false);
    expect(membersFirstDue({ ...session, settled: { at: 'x' } }, end)).toBe(false);
    expect(membersFirstOpen({ datetime: session.datetime }, end - 1)).toBe(false);
    expect(membersFirstOpen(null, end - 1)).toBe(false);
  });
});

describe('isMembersFirst', () => {
  it('takes whole days 1–6 and a 24-hour HH:MM', () => {
    expect(isMembersFirst({ daysBefore: 1, time: '00:00' })).toBe(true);
    expect(isMembersFirst({ daysBefore: 6, time: '23:59' })).toBe(true);
    for (const bad of [null, {}, { daysBefore: 0, time: '10:00' }, { daysBefore: 2.5, time: '10:00' }, { daysBefore: 2, time: '7:00' }]) {
      expect(isMembersFirst(bad)).toBe(false);
    }
  });
});
