import { describe, it, expect } from 'vitest';
import { feeShareOf, linesPartOfRefund, maxAllowedSurcharge, surchargeCents, validSurchargeBps } from '@/lib/surchargeMath';

/** The card fee's arithmetic (docs/plans/card-surcharge.md): always rounded DOWN, never over 2.4%. */
describe('surcharge math', () => {
  it('2.4% of the lines, rounded down', () => {
    expect(surchargeCents(2700, 240)).toBe(64); // 64.8
    expect(surchargeCents(1373, 240)).toBe(32); // 32.95
    expect(surchargeCents(1000, 100)).toBe(10);
  });

  it('never above Stripe’s ceiling, never negative, nothing on a bad rate or amount', () => {
    expect(surchargeCents(2700, 240, 50)).toBe(50);
    expect(surchargeCents(2700, 240, 0)).toBe(0);
    expect(surchargeCents(2700, 241)).toBe(0);
    expect(surchargeCents(2700, 0)).toBe(0);
    expect(surchargeCents(-5, 240)).toBe(0);
  });

  it('accepts whole basis points from 1 to 240 only', () => {
    expect([1, 240].map(validSurchargeBps)).toEqual([true, true]);
    expect([0, 241, 2.4, '240', null].map(validSurchargeBps)).toEqual([false, false, false, false, false]);
  });

  it('the most a charge may carry is 2.4% of its lines', () => {
    expect(maxAllowedSurcharge(2700)).toBe(64);
  });

  it('a refund: the lines’ part of what came back, and the fee that goes with a line', () => {
    expect(linesPartOfRefund(2764, 2700, 64)).toBe(2700);
    expect(linesPartOfRefund(1228, 2700, 64)).toBe(1200);
    expect(linesPartOfRefund(1500, 2700, 0)).toBe(1500);
    expect(feeShareOf(1500, 2700, 64)).toBe(35);
    expect(feeShareOf(2700, 2700, 64)).toBe(64);
  });
});
