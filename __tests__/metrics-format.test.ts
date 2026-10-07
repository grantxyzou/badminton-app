import { describe, it, expect } from 'vitest';
import { pct, duration, dayCount, shortDate, monthLabel, NONE } from '@/lib/metricsFormat';

describe('metricsFormat', () => {
  it('writes null as the dash, never 0', () => {
    for (const f of [pct, duration, dayCount]) {
      expect(f(null)).toBe(NONE);
      expect(f(undefined)).toBe(NONE);
      expect(f(Number.NaN)).toBe(NONE);
    }
  });

  it('pct rounds to a whole percent', () => {
    expect(pct(0)).toBe('0%');
    expect(pct(0.4567)).toBe('46%');
    expect(pct(1)).toBe('100%');
  });

  it('duration reads like a person would say it', () => {
    expect(duration(0.4)).toBe('under a minute');
    expect(duration(12)).toBe('12 min');
    expect(duration(60)).toBe('1 h');
    expect(duration(190)).toBe('3 h 10 min');
    expect(duration(24 * 60)).toBe('1 d');
    expect(duration(2 * 24 * 60 + 4 * 60)).toBe('2 d 4 h');
    expect(duration(-5)).toBe(NONE);
  });

  it('dayCount', () => {
    expect(dayCount(0.04)).toBe('0');
    expect(dayCount(1)).toBe('1');
    expect(dayCount(2.54)).toBe('2.5');
    expect(dayCount(-1)).toBe(NONE);
  });

  it('dates without a timezone shift', () => {
    expect(shortDate('2026-10-02')).toBe('Oct 2');
    expect(shortDate('2026-01-31')).toBe('Jan 31');
    expect(monthLabel('2026-07')).toBe('Jul 2026');
  });
});
