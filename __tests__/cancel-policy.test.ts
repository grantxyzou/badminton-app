import { describe, it, expect } from 'vitest';
import { isValidLateCancelHours, lateCancelHoursOf, lateCancelVerdict } from '@/lib/cancelPolicy';

/**
 * The late-cancellation rule (docs/plans/late-cancel-fee.md), as arithmetic.
 * The route only asks it; every edge lives here.
 */
const H = 3_600_000;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const at = (hoursFromNow: number) => new Date(NOW + hoursFromNow * H).toISOString();

describe('isValidLateCancelHours', () => {
  it('accepts whole hours from 1 to 168', () => {
    for (const v of [1, 24, 48, 72, 168]) expect(isValidLateCancelHours(v)).toBe(true);
  });
  it('refuses zero, fractions, out of range and non-numbers', () => {
    for (const v of [0, -1, 1.5, 169, NaN, Infinity, '48', null, undefined]) expect(isValidLateCancelHours(v)).toBe(false);
  });
});

describe('lateCancelHoursOf — the club setting, or null when off', () => {
  it('reads a valid setting', () => {
    expect(lateCancelHoursOf({ lateCancelHours: 48 })).toBe(48);
  });
  it('treats absent, missing settings and a corrupt value as off', () => {
    expect(lateCancelHoursOf({})).toBeNull();
    expect(lateCancelHoursOf(undefined)).toBeNull();
    expect(lateCancelHoursOf(null)).toBeNull();
    expect(lateCancelHoursOf({ lateCancelHours: 0 })).toBeNull();
    expect(lateCancelHoursOf({ lateCancelHours: '48' })).toBeNull();
  });
});

describe('lateCancelVerdict', () => {
  it('is late inside the window, with the whole hours left', () => {
    expect(lateCancelVerdict(at(20.5), NOW, 48)).toEqual({ late: true, hoursBefore: 20 });
  });
  it('is not late outside the window', () => {
    expect(lateCancelVerdict(at(49), NOW, 48)).toEqual({ late: false, hoursBefore: 49 });
  });
  it('is not late at exactly the window', () => {
    expect(lateCancelVerdict(at(48), NOW, 48).late).toBe(false);
  });
  it('is late once the session has started, with hours clamped at 0', () => {
    expect(lateCancelVerdict(at(-2), NOW, 48)).toEqual({ late: true, hoursBefore: 0 });
  });
  it('is never late with the policy off', () => {
    expect(lateCancelVerdict(at(1), NOW, null)).toEqual({ late: false, hoursBefore: 1 });
  });
  it('is never late without a usable start time', () => {
    expect(lateCancelVerdict(undefined, NOW, 48)).toEqual({ late: false, hoursBefore: null });
    expect(lateCancelVerdict('not a date', NOW, 48)).toEqual({ late: false, hoursBefore: null });
  });
});
