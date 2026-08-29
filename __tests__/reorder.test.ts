import { describe, it, expect } from 'vitest';
import { moveItem, canMove } from '@/lib/reorder';

/**
 * The arithmetic behind reordering the rate card.
 *
 * The buttons need a browser; WHERE a row lands does not, and that is where the
 * off-by-ones live — a reorder that silently drops or duplicates a row is worse
 * than no reorder, because someone has to notice it before they can fix it.
 */
describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves down, closing the gap behind it', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves up, pushing the rest along', () => {
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to either end', () => {
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('never mutates the input — the caller keeps it for rollback', () => {
    const original = [...list];
    moveItem(list, 0, 3);
    expect(list).toEqual(original);
  });

  it('is a no-op copy for a move to itself or out of range', () => {
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, -1, 2)).toEqual(list);
    expect(moveItem(list, 0, 9)).toEqual(list);
  });

  it('preserves length for every legal pair', () => {
    // Brute force: an off-by-one that drops or duplicates an item is the
    // failure that would silently delete someone's rate card.
    for (let from = 0; from < list.length; from++) {
      for (let to = 0; to < list.length; to++) {
        const out = moveItem(list, from, to);
        expect(out).toHaveLength(list.length);
        expect([...out].sort()).toEqual([...list].sort());
      }
    }
  });
});

describe('canMove', () => {
  it('refuses to move the ends off the list', () => {
    expect(canMove(0, -1, 3)).toBe(false);
    expect(canMove(2, 1, 3)).toBe(false);
  });

  it('allows every move in between', () => {
    expect(canMove(0, 1, 3)).toBe(true);
    expect(canMove(1, -1, 3)).toBe(true);
    expect(canMove(1, 1, 3)).toBe(true);
    expect(canMove(2, -1, 3)).toBe(true);
  });

  it('says no for a single-item list, which has nowhere to go', () => {
    expect(canMove(0, -1, 1)).toBe(false);
    expect(canMove(0, 1, 1)).toBe(false);
  });
});
