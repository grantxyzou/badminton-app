// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { canCover } from '@/components/admin/CommandCenter/PaymentsCard';

/**
 * `canCover` is the single shared predicate for "this player has an outstanding,
 * coverable debt" — used by both the "Cover their $X" ActionRow and the
 * remove-intercept. They previously drifted (the ActionRow omitted `!paid`),
 * offering to write off a debt the player had already paid.
 */
describe('canCover — outstanding-debt predicate', () => {
  it('is true for an unpaid, un-written-off player who owes money', () => {
    expect(canCover({ owedAmount: 12, paid: false, writtenOff: false })).toBe(true);
  });

  it('is false once the player has paid (the bug: ActionRow offered Cover anyway)', () => {
    expect(canCover({ owedAmount: 12, paid: true, writtenOff: false })).toBe(false);
  });

  it('is false once already written off', () => {
    expect(canCover({ owedAmount: 12, paid: false, writtenOff: true })).toBe(false);
  });

  it('is false when nothing is owed', () => {
    expect(canCover({ owedAmount: 0, paid: false, writtenOff: false })).toBe(false);
  });

  it('is false when owedAmount is absent (never settled)', () => {
    expect(canCover({ paid: false, writtenOff: false })).toBe(false);
  });

  it('is false for null (no action target)', () => {
    expect(canCover(null)).toBe(false);
  });
});
