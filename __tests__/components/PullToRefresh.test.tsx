// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import PullToRefresh from '../../components/PullToRefresh';
import { registerOpenSheet } from '../../lib/sheetStack';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

/** A touch at (x, y) — jsdom has no Touch constructor, so a plain object will do. */
function touch(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
  e.touches = type === 'touchend' ? [] : [{ clientX: x, clientY: y }];
  document.dispatchEvent(e);
}

async function pull(dy: number, dx = 0) {
  touch('touchstart', 100, 100);
  for (let step = 1; step <= 10; step++) touch('touchmove', 100 + (dx * step) / 10, 100 + (dy * step) / 10);
  await act(async () => { touch('touchend', 0, 0); });
}

function mount(onRefresh = vi.fn(async () => {})) {
  const { container } = render(<PullToRefresh onRefresh={onRefresh} />);
  return { onRefresh, wrap: container.querySelector('.ptr') as HTMLElement };
}

describe('PullToRefresh', () => {
  it('a deliberate pull of ~200px refreshes once', async () => {
    const { onRefresh } = mount();
    await pull(200);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('a flick-sized pull (~120px) springs back and refreshes nothing', async () => {
    const { onRefresh, wrap } = mount();
    await pull(120);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(wrap.style.transform).toBe('translate3d(0, 0px, 0)');
  });

  it('follows the finger without animating, and marks the moment it arms', () => {
    const { wrap } = mount();
    touch('touchstart', 100, 100);
    touch('touchmove', 100, 150);
    expect(wrap.dataset.settle).toBe('false');
    expect(wrap.dataset.armed).toBe('false');
    touch('touchmove', 100, 300);
    expect(wrap.dataset.armed).toBe('true');
  });

  it('a scroll that starts upward can never become a pull, even if it comes back down', async () => {
    const { onRefresh } = mount();
    touch('touchstart', 100, 100);
    touch('touchmove', 100, 80); // up: a scroll
    touch('touchmove', 100, 300); // back down past the trigger
    await act(async () => { touch('touchend', 0, 0); });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('a sideways swipe is not a pull', async () => {
    const { onRefresh } = mount();
    await pull(120, 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does nothing when the page is not at the top', async () => {
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true });
    const { onRefresh } = mount();
    await pull(200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does nothing while a sheet is open — asked of the sheet stack, not sniffed from body styles', async () => {
    const { onRefresh } = mount();
    const unregister = registerOpenSheet(() => {});
    await pull(200);
    unregister();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
