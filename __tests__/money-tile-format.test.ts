import { describe, it, expect } from 'vitest';
import { fmtMoneyTile } from '@/lib/fmt';

// A tile on a 390px phone holds 75px at --fs-stat; measured in a browser on
// 2026-10-27, the widest forms are "($999K)" at 75px and "($9.99)" under it.
// A character count is the proxy a unit test can check.
const FITS = 7;

describe('fmtMoneyTile', () => {
  it('keeps cents only under $10, whole dollars to $999', () => {
    expect(fmtMoneyTile(900)).toBe('$9.00');
    expect(fmtMoneyTile(999)).toBe('$9.99');
    expect(fmtMoneyTile(1000)).toBe('$10');
    expect(fmtMoneyTile(48050)).toBe('$481');
    expect(fmtMoneyTile(99900)).toBe('$999');
    expect(fmtMoneyTile(99950)).toBe('$1K');
  });

  it('switches to K at a thousand, one decimal until ten', () => {
    expect(fmtMoneyTile(100_000)).toBe('$1K');
    expect(fmtMoneyTile(343_556)).toBe('$3.4K');
    expect(fmtMoneyTile(609_084)).toBe('$6.1K');
    expect(fmtMoneyTile(9_900_000)).toBe('$99K');
  });

  it('rolls into the next rung instead of writing $10.0K or $1000K', () => {
    expect(fmtMoneyTile(999_999)).toBe('$10K');
    expect(fmtMoneyTile(99_999_999)).toBe('$1M');
    expect(fmtMoneyTile(125_000_000)).toBe('$1.3M');
  });

  it('brackets a negative instead of a minus sign', () => {
    expect(fmtMoneyTile(-265528)).toBe('($2.7K)');
    expect(fmtMoneyTile(-20500)).toBe('($205)');
    expect(fmtMoneyTile(-999)).toBe('($9.99)');
    const net = fmtMoneyTile(-265528);
    expect(net.startsWith('(')).toBe(true);
    expect(net.endsWith(')')).toBe(true);
    expect(net).not.toContain('-');
    expect(net).not.toContain('−');
  });

  it('zero is $0.00, not blank', () => {
    expect(fmtMoneyTile(0)).toBe('$0.00');
  });

  it('every figure the ledger shows today fits a tile', () => {
    for (const cents of [343556, 609084, -265528, 22853, 1789, 999999, -99_999_99, -99_949_99, -999, -99_900]) {
      expect(fmtMoneyTile(cents).length, fmtMoneyTile(cents)).toBeLessThanOrEqual(FITS);
    }
  });
});
