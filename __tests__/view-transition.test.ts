// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { canViewTransition, withViewTransition } from '@/lib/viewTransition';

/**
 * The morph must never be the only way a state change lands: no API, or
 * reduced motion, means the update simply happens.
 */
type Doc = { startViewTransition?: unknown };
const doc = () => document as unknown as Doc;

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q }) as MediaQueryList);
  window.matchMedia = globalThis.matchMedia;
}

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.unstubAllGlobals();
});

describe('withViewTransition', () => {
  it('runs the update directly where the browser has no View Transitions', () => {
    reducedMotion(false);
    const update = vi.fn();
    expect(withViewTransition(update)).toBe(false);
    expect(update).toHaveBeenCalledOnce();
  });

  it('runs the update directly under prefers-reduced-motion, even with the API', () => {
    reducedMotion(true);
    const start = vi.fn();
    doc().startViewTransition = start;
    const update = vi.fn();
    expect(canViewTransition()).toBe(false);
    expect(withViewTransition(update)).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('runs the update inside a transition when both allow it', () => {
    reducedMotion(false);
    const start = vi.fn((cb: () => void) => cb());
    doc().startViewTransition = start;
    const update = vi.fn();
    expect(withViewTransition(update)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('holds the scope class on <html> only until the transition finishes', async () => {
    reducedMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((r) => { finish = r; });
    doc().startViewTransition = vi.fn((cb: () => void) => { cb(); return { finished }; });
    withViewTransition(() => {}, 'vt-test');
    // Present while the transition runs: the names hang off this class.
    expect(document.documentElement.classList.contains('vt-test')).toBe(true);
    finish();
    await finished;
    await Promise.resolve();
    // Gone after: a permanent name would change how glass composites.
    expect(document.documentElement.classList.contains('vt-test')).toBe(false);
  });
});
