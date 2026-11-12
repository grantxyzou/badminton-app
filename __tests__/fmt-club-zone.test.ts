import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fmtShortDate, fmtSessionLabel, fmtFullDate, fmtDeadline, fmtTime } from '@/lib/fmt';

// The admin console's dates and times read on the club's clock
// (America/Vancouver), not the device's. Thursday 7 PM Pacific is Friday
// 02:00 UTC, so on a device in UTC every helper used to land on the wrong day
// and hour. July, because tzdata 2026e keeps Vancouver on -07:00 all year from
// 2026 and older tzdata falls back to -08:00 in November: in July both agree,
// so the hour asserted here holds on any Node.
const THURSDAY_7PM = '2026-07-16T19:00:00-07:00';
// A bare calendar day (a shuttle purchase's `date`) must read as the day
// written, on any device and on the club's clock alike.
const PURCHASE_DAY = '2026-07-16';
// Newer ICU puts a narrow no-break space before AM/PM; compare as plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ');

describe.each(['UTC', 'Asia/Tokyo', 'America/Vancouver'])('lib/fmt on a device in %s', (tz) => {
  let savedTz: string | undefined;
  beforeEach(() => {
    savedTz = process.env.TZ;
    process.env.TZ = tz;
  });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it('a session moment reads in Vancouver time', () => {
    expect(fmtShortDate(THURSDAY_7PM)).toBe('Jul 16');
    expect(fmtSessionLabel(THURSDAY_7PM)).toBe('Thu, Jul 16');
    expect(fmtFullDate(THURSDAY_7PM)).toBe('Jul 16, 2026');
    expect(plain(fmtTime(THURSDAY_7PM))).toBe('7:00 PM');
    expect(plain(fmtDeadline(THURSDAY_7PM))).toBe('Thu 7:00 PM');
  });

  it('a bare YYYY-MM-DD reads as the day written', () => {
    expect(fmtShortDate(PURCHASE_DAY)).toBe('Jul 16');
    expect(fmtSessionLabel(PURCHASE_DAY)).toBe('Thu, Jul 16');
    expect(fmtFullDate(PURCHASE_DAY)).toBe('Jul 16, 2026');
  });
});

describe('the zone override is real (or the tests above prove nothing)', () => {
  it('in UTC the session moment is on Friday', () => {
    const saved = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      expect(new Date(THURSDAY_7PM).getDate()).toBe(17);
      expect(new Date(PURCHASE_DAY).toLocaleDateString('en-US', { timeZone: 'America/Vancouver', day: 'numeric' })).toBe('15');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
