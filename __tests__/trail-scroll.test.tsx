// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

/**
 * Each level of a page trail keeps its own place (lib/trailScroll.ts; Grant,
 * 2026-11-15: "Remember position"). jsdom has no layout, so the page's scroll
 * is a number this test owns.
 */
const page = vi.hoisted(() => ({ y: 0 }));
vi.mock('@/lib/pageScroll', () => ({
  pageScrollTop: () => page.y,
  scrollPageTo: (y: number) => { page.y = y; },
}));

import { useTrailScroll } from '@/lib/trailScroll';

beforeEach(() => { page.y = 0; });
afterEach(cleanup);

describe('useTrailScroll', () => {
  it('opens a page at its top and gives the console its place back', () => {
    const { result, rerender } = renderHook(({ depth }) => useTrailScroll(depth, true), { initialProps: { depth: 0 } });
    page.y = 640; // the console, scrolled to Roster
    result.current();
    rerender({ depth: 1 });
    expect(page.y).toBe(0);
    page.y = 120; // down the page
    rerender({ depth: 0 });
    expect(page.y).toBe(640);
  });

  it('keeps every level: How your club runs → Late cancellations → Back → Back', () => {
    const { result, rerender } = renderHook(({ depth }) => useTrailScroll(depth, true), { initialProps: { depth: 0 } });
    page.y = 500; result.current(); rerender({ depth: 1 });
    page.y = 300; result.current(); rerender({ depth: 2 });
    expect(page.y).toBe(0);
    rerender({ depth: 1 });
    expect(page.y).toBe(300);
    rerender({ depth: 0 });
    expect(page.y).toBe(500);
  });

  it('a level opened again starts fresh, not at an old page\'s place', () => {
    const { result, rerender } = renderHook(({ depth }) => useTrailScroll(depth, true), { initialProps: { depth: 0 } });
    page.y = 200; result.current(); rerender({ depth: 1 });
    page.y = 90; result.current(); rerender({ depth: 2 });
    rerender({ depth: 1 });
    rerender({ depth: 0 });
    // Into a page again, and straight back without noting a new place for it.
    rerender({ depth: 1 });
    expect(page.y).toBe(0);
    rerender({ depth: 0 });
    expect(page.y).toBe(200);
  });

  it('a page that opens from the console without a noted place returns to the top', () => {
    const { rerender } = renderHook(({ depth }) => useTrailScroll(depth, true), { initialProps: { depth: 0 } });
    page.y = 400;
    rerender({ depth: 1 });
    rerender({ depth: 0 });
    expect(page.y).toBe(0);
  });

  it('does nothing on two pages, where the console keeps its own side', () => {
    const { result, rerender } = renderHook(({ depth }) => useTrailScroll(depth, false), { initialProps: { depth: 0 } });
    page.y = 400; result.current();
    rerender({ depth: 1 });
    expect(page.y).toBe(400);
    page.y = 50;
    rerender({ depth: 0 });
    expect(page.y).toBe(50);
  });
});
