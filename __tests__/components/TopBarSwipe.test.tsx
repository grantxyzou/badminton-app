// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import TopBar from '@/components/primitives/TopBar';

/**
 * The edge swipe back is forgiving, like the phone's own (Grant, 2026-11-15:
 * "the swipe is janky, not always work"). It used to need a start inside 24px,
 * a release inside 600ms and under 40px of drift, and the page kept scrolling
 * under the finger.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function touch(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown; changedTouches: unknown };
  const pt = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : pt });
  Object.defineProperty(e, 'changedTouches', { value: pt });
  document.dispatchEvent(e);
  return e;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

function page() {
  const onBack = vi.fn();
  render(<TopBar title="Roster" onBack={onBack} />);
  return onBack;
}

describe('edge swipe back', () => {
  it('a slow, deliberate drag across goes back', async () => {
    const onBack = page();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    touch('touchstart', 10, 400);
    touch('touchmove', 80, 405);
    now.mockReturnValue(1500); // well past the old 600ms
    touch('touchmove', 140, 410);
    touch('touchend', 140, 410);
    await frame();
    expect(onBack).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('starts from a thumb a little in from the edge (a phone in a case)', async () => {
    const onBack = page();
    touch('touchstart', 30, 400);
    touch('touchmove', 120, 400);
    touch('touchend', 160, 400);
    await frame();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps a natural arc: a swipe that drifts 50px down still counts', async () => {
    const onBack = page();
    touch('touchstart', 8, 400);
    touch('touchmove', 90, 420);
    touch('touchmove', 170, 450);
    touch('touchend', 170, 450);
    await frame();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a short, slow drag springs back', async () => {
    const onBack = page();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    touch('touchstart', 8, 400);
    touch('touchmove', 60, 400);
    now.mockReturnValue(1000);
    touch('touchend', 90, 400);
    await frame();
    expect(onBack).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it('a scroll that starts at the edge stays a scroll', async () => {
    const onBack = page();
    touch('touchstart', 8, 400);
    const move = touch('touchmove', 14, 300);
    touch('touchmove', 150, 200);
    touch('touchend', 150, 200);
    await frame();
    expect(onBack).not.toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(false);
  });

  it('holds the page still once the drag is plainly sideways', () => {
    page();
    touch('touchstart', 8, 400);
    const first = touch('touchmove', 12, 401); // not yet decided
    const sideways = touch('touchmove', 60, 404);
    expect(first.defaultPrevented).toBe(false);
    expect(sideways.defaultPrevented).toBe(true);
    touch('touchend', 60, 404);
    // The next, ordinary touch is never held.
    touch('touchstart', 200, 400);
    expect(touch('touchmove', 200, 300).defaultPrevented).toBe(false);
  });

  it('survives the page re-rendering with a new Back mid-swipe (Roster passes a new one every render)', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<TopBar title="Roster" onBack={() => first()} />);
    touch('touchstart', 8, 400);
    touch('touchmove', 80, 400);
    rerender(<TopBar title="Roster" onBack={() => second()} />);
    touch('touchmove', 150, 400);
    touch('touchend', 150, 400);
    await frame();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a touch away from the edge is never held or taken as Back', async () => {
    const onBack = page();
    touch('touchstart', 120, 400);
    const move = touch('touchmove', 300, 400);
    touch('touchend', 300, 400);
    await frame();
    expect(onBack).not.toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(false);
  });
});
