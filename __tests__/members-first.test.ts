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
/**
 * The end, read back on the club's clock. The tests assert WALL time, never a
 * UTC instant: the instant depends on the platform's time-zone rules, and CI's
 * newer tzdata keeps Vancouver on UTC−7 all year from November 2026 (British
 * Columbia's permanent daylight time) while older data falls back to UTC−8.
 * "Monday 11:59 PM" is the rule either way, and that is what is checked.
 */
function wall(iso: string | null): string | null {
  if (iso === null) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Vancouver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Saturday 14 November 2026, 7 or 8 PM in Vancouver under either rule set.
const SATURDAY = '2026-11-15T03:00:00.000Z';

describe('membersFirstEnd', () => {
  it('a Saturday evening session with Six Feathers’ rule ends Monday 11:59 PM', () => {
    expect(wall(membersFirstEnd(SATURDAY, DEFAULT_MEMBERS_FIRST))).toBe('2026-11-09 23:59');
  });

  it('keeps the wall time across a daylight-saving change', () => {
    // Clocks fall back (where they still do) on Sun 1 Nov 2026.
    expect(wall(membersFirstEnd('2026-11-08T03:00:00.000Z', { daysBefore: 6, time: '20:00' }))).toBe('2026-11-01 20:00');
    // Clocks spring forward on Sun 8 Mar 2026.
    expect(wall(membersFirstEnd('2026-03-15T02:00:00.000Z', { daysBefore: 6, time: '23:59' }))).toBe('2026-03-08 23:59');
  });

  it('counts days on the club’s calendar, not the server’s', () => {
    // Already Saturday the 14th in UTC; still Friday the 13th in Vancouver.
    expect(wall(membersFirstEnd('2026-11-14T06:00:00.000Z', { daysBefore: 1, time: '12:00' }))).toBe('2026-11-12 12:00');
  });

  it('answers null for a missing rule or start', () => {
    expect(membersFirstEnd(undefined, DEFAULT_MEMBERS_FIRST)).toBeNull();
    expect(membersFirstEnd('not a date', DEFAULT_MEMBERS_FIRST)).toBeNull();
    expect(membersFirstEnd(SATURDAY, undefined)).toBeNull();
    expect(membersFirstEnd(SATURDAY, { daysBefore: 9, time: '23:59' })).toBeNull();
  });
});

describe('open and due', () => {
  const session = { datetime: SATURDAY, membersFirst: DEFAULT_MEMBERS_FIRST };
  const end = Date.parse(membersFirstEnd(SATURDAY, DEFAULT_MEMBERS_FIRST)!);
  const start = Date.parse(SATURDAY);

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
