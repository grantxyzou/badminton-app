import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CLUB_TIME_ZONE,
  fmtShortDate,
  fmtSessionLabel,
  fmtFullDate,
  fmtDeadline,
  fmtTime,
} from '@/lib/fmt';

/**
 * Session dates and times are the club's, not the device's. Thursday 7 PM
 * in Vancouver is Friday 02:00 UTC, so a phone set to UTC printed "Fri,
 * Oct 16" and "2:00 AM" for a Thursday-night session until every helper in
 * `lib/fmt.ts` was given `timeZone: CLUB_TIME_ZONE`.
 *
 * The fixture is in October on purpose. tzdata 2026e has BC stop falling
 * back on 2026-11-01 (UTC-7 all year), so a November time reads an hour
 * apart on a machine with older tz data. Mid-October is UTC-7 under both.
 */
function withTz(tz: string) {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

describe('the date is the club’s: a device in UTC', () => {
  withTz('UTC');
  const thursdayNight = '2026-10-15T19:00:00-07:00';

  it('the device really is in UTC here (or this test proves nothing)', () => {
    expect(new Date(thursdayNight).getDate()).toBe(16);
    expect(new Date(thursdayNight).getHours()).toBe(2);
  });

  it('pins to Vancouver', () => {
    expect(CLUB_TIME_ZONE).toBe('America/Vancouver');
  });

  it('fmtShortDate reads Oct 15', () => {
    expect(fmtShortDate(thursdayNight)).toBe('Oct 15');
  });

  it('fmtSessionLabel reads Thu, Oct 15', () => {
    expect(fmtSessionLabel(thursdayNight)).toBe('Thu, Oct 15');
  });

  it('fmtFullDate reads Oct 15, 2026', () => {
    expect(fmtFullDate(thursdayNight)).toBe('Oct 15, 2026');
  });

  it('fmtDeadline reads Thu 7:00 PM', () => {
    expect(fmtDeadline(thursdayNight)).toMatch(/^Thu,? 7:00\s?PM$/);
  });

  it('fmtTime reads 7:00 PM', () => {
    expect(fmtTime(thursdayNight)).toMatch(/^7:00\s?PM$/);
  });

  it('a bare purchase date keeps its day', () => {
    expect(fmtShortDate('2026-11-19')).toBe('Nov 19');
  });
});

describe('a bare YYYY-MM-DD is a calendar day: a device in Vancouver', () => {
  withTz('America/Vancouver');

  it('the device really is in Vancouver here (or this test proves nothing)', () => {
    // UTC midnight is the afternoon before in Vancouver.
    expect(new Date('2026-11-19').getDate()).toBe(18);
  });

  it('a shuttle purchase dated Nov 19 reads Nov 19, not Nov 18', () => {
    expect(fmtShortDate('2026-11-19')).toBe('Nov 19');
    expect(fmtFullDate('2026-11-19')).toBe('Nov 19, 2026');
  });

  it('a session instant still reads in club time', () => {
    expect(fmtSessionLabel('2026-10-15T19:00:00-07:00')).toBe('Thu, Oct 15');
  });
});
