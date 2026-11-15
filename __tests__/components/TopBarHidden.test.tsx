// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import TopBar from '@/components/primitives/TopBar';

/**
 * A bar inside a `hidden` box is not the page on screen, and answers neither
 * the edge swipe nor Escape. Pages are kept mounted behind the one on screen
 * (every visited tab in HomeShell, the Admin console under each Admin page),
 * and before this one swipe back from an Admin page also ran the hidden
 * console's "Back to profile": Late cancellations went straight to Profile
 * (Grant, 2026-11-13, App Store app).
 */
afterEach(cleanup);

function touch(type: string, x: number, y: number) {
  const e = new Event(type, { bubbles: true }) as Event & { touches: unknown; changedTouches: unknown };
  const pt = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : pt });
  Object.defineProperty(e, 'changedTouches', { value: pt });
  document.dispatchEvent(e);
}

async function edgeSwipe() {
  touch('touchstart', 8, 400);
  touch('touchmove', 100, 400);
  touch('touchmove', 180, 400);
  touch('touchend', 180, 400);
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

function Pages({ onConsole, onPage }: { onConsole: () => void; onPage: () => void }) {
  // AdminDashboard's shape: the console hidden under the page on top of it.
  return (
    <>
      <div hidden>
        <TopBar title="Admin" onBack={onConsole} />
      </div>
      <TopBar title="Late cancellations" onBack={onPage} />
    </>
  );
}

describe('TopBar under a hidden box', () => {
  it('one edge swipe goes back one page, not the hidden console too', async () => {
    const onConsole = vi.fn();
    const onPage = vi.fn();
    render(<Pages onConsole={onConsole} onPage={onPage} />);
    await edgeSwipe();
    expect(onPage).toHaveBeenCalledOnce();
    expect(onConsole).not.toHaveBeenCalled();
  });

  it('Escape goes back only on the page on screen', () => {
    const onConsole = vi.fn();
    const onPage = vi.fn();
    render(<Pages onConsole={onConsole} onPage={onPage} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onPage).toHaveBeenCalledOnce();
    expect(onConsole).not.toHaveBeenCalled();
  });

  it('a bar in a hidden tab ignores the swipe entirely', async () => {
    const onBack = vi.fn();
    render(<div hidden><TopBar title="Groups" onBack={onBack} /></div>);
    await edgeSwipe();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-swiping')).toBe(false);
  });
});
