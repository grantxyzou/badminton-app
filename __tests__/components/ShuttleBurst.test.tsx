// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import ShuttleBurst from '@/components/home/ShuttleBurst';
import { BURST_COUNT } from '@/lib/shuttleBurst';

/**
 * The layer half of the sign-up burst (docs/plans/signup-shuttle-burst.md).
 * jsdom runs no animation, so what can be pinned is the contract around it:
 * fourteen pieces on a fixed, inert layer portaled to body, each carrying its
 * own custom properties; nothing for reduced motion; cleared when told.
 */

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })));
}

const origin = { x: 120, y: 480, key: 1 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ShuttleBurst', () => {
  it('renders nothing with no origin', () => {
    render(<ShuttleBurst origin={null} onDone={() => {}} />);
    expect(document.querySelector('.shuttle-burst')).toBeNull();
  });

  it('portals fourteen pieces to body, centred on the origin, each with its own flight', () => {
    render(<div id="host"><ShuttleBurst origin={origin} onDone={() => {}} /></div>);
    const layer = document.querySelector('.shuttle-burst') as HTMLElement;
    expect(layer).not.toBeNull();
    // Portaled: a child of body, not of the host the component rendered under.
    expect(layer.parentElement).toBe(document.body);
    expect(document.querySelector('#host .shuttle-burst')).toBeNull();
    expect(layer.getAttribute('aria-hidden')).toBe('true');

    const pieces = Array.from(layer.querySelectorAll('img.shuttle-burst__piece')) as HTMLImageElement[];
    expect(pieces).toHaveLength(BURST_COUNT);
    const flights = new Set<string>();
    for (const img of pieces) {
      expect(img.style.left).toBe('120px');
      expect(img.style.top).toBe('480px');
      expect(img.getAttribute('src')).toMatch(/\/brand\/baddicon-(pink|yello|green)\.svg$/);
      expect(img.getAttribute('alt')).toBe('');
      for (const prop of ['--burst-dx', '--burst-dy', '--burst-rot', '--burst-dur', '--burst-delay']) {
        expect(img.style.getPropertyValue(prop), prop).not.toBe('');
      }
      flights.add(`${img.style.getPropertyValue('--burst-dx')}|${img.style.getPropertyValue('--burst-dy')}|${img.style.width}`);
    }
    // "Direction and size should be random": fourteen pieces, not one flight repeated.
    expect(flights.size).toBeGreaterThan(5);
  });

  it('mounts nothing under prefers-reduced-motion', () => {
    stubReducedMotion(true);
    render(<ShuttleBurst origin={origin} onDone={() => {}} />);
    expect(document.querySelector('.shuttle-burst')).toBeNull();
  });

  it('calls onDone once the last piece has landed, and not before', () => {
    const onDone = vi.fn();
    render(<ShuttleBurst origin={origin} onDone={onDone} />);
    act(() => { vi.advanceTimersByTime(400); });
    expect(onDone).not.toHaveBeenCalled();
    // Longest possible flight: BURST_DUR_MAX + BURST_DELAY_MAX + the beat.
    act(() => { vi.advanceTimersByTime(900 + 80 + 50); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('replays for a new key and clears when the origin is withdrawn', () => {
    const { rerender } = render(<ShuttleBurst origin={origin} onDone={() => {}} />);
    const first = (document.querySelector('.shuttle-burst__piece') as HTMLImageElement).style.getPropertyValue('--burst-dx');
    rerender(<ShuttleBurst origin={{ x: 10, y: 20, key: 2 }} onDone={() => {}} />);
    const again = document.querySelectorAll('.shuttle-burst__piece');
    expect(again).toHaveLength(BURST_COUNT);
    expect((again[0] as HTMLImageElement).style.left).toBe('10px');
    // Not asserted equal or different: a fresh random draw may repeat a value.
    expect(typeof first).toBe('string');
    rerender(<ShuttleBurst origin={null} onDone={() => {}} />);
    expect(document.querySelector('.shuttle-burst')).toBeNull();
  });
});
