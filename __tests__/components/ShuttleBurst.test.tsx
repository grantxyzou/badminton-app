// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import ShuttleBurst from '@/components/home/ShuttleBurst';
import { BURST_COUNT } from '@/lib/shuttleBurst';

/**
 * The layer half of the sign-up burst (docs/plans/signup-shuttle-burst.md).
 * jsdom runs no animation, so what can be pinned is the contract around it:
 * fourteen pieces on a fixed, inert layer portaled to body, each a path
 * wrapper carrying its flight properties around an image carrying its
 * attitude; nothing for reduced motion; cleared when told.
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

  it('portals fourteen pieces to body, centred on the origin, each with its own flight and attitude', () => {
    render(<div id="host"><ShuttleBurst origin={origin} onDone={() => {}} /></div>);
    const layer = document.querySelector('.shuttle-burst') as HTMLElement;
    expect(layer).not.toBeNull();
    // Portaled: a child of body, not of the host the component rendered under.
    expect(layer.parentElement).toBe(document.body);
    expect(document.querySelector('#host .shuttle-burst')).toBeNull();
    expect(layer.getAttribute('aria-hidden')).toBe('true');

    const pieces = Array.from(layer.querySelectorAll('.shuttle-burst__piece')) as HTMLElement[];
    expect(pieces).toHaveLength(BURST_COUNT);
    const flights = new Set<string>();
    for (const piece of pieces) {
      expect(piece.style.left).toBe('120px');
      expect(piece.style.top).toBe('480px');
      for (const prop of ['--burst-x1', '--burst-y1', '--burst-x2', '--burst-y2', '--burst-dur', '--burst-delay']) {
        expect(piece.style.getPropertyValue(prop), prop).not.toBe('');
      }
      const img = piece.querySelector('img.shuttle-burst__body') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toMatch(/\/brand\/baddicon-(pink|yello|green)\.svg$/);
      expect(img.getAttribute('alt')).toBe('');
      for (const prop of ['--burst-aim', '--burst-rest', '--burst-wobble', '--burst-dur', '--burst-delay']) {
        expect(img.style.getPropertyValue(prop), prop).not.toBe('');
      }
      // The path and the attitude share one clock, or the nose turns down
      // before or after the apex.
      expect(img.style.getPropertyValue('--burst-dur')).toBe(piece.style.getPropertyValue('--burst-dur'));
      expect(img.style.getPropertyValue('--burst-delay')).toBe(piece.style.getPropertyValue('--burst-delay'));
      flights.add(`${piece.style.getPropertyValue('--burst-x1')}|${piece.style.getPropertyValue('--burst-y1')}|${img.style.width}`);
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
    act(() => { vi.advanceTimersByTime(600); });
    expect(onDone).not.toHaveBeenCalled();
    // Longest possible flight: BURST_DUR_MAX + BURST_DELAY_MAX + the beat.
    act(() => { vi.advanceTimersByTime(1400 + 160 + 50); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('replays for a new key and clears when the origin is withdrawn', () => {
    const { rerender } = render(<ShuttleBurst origin={origin} onDone={() => {}} />);
    rerender(<ShuttleBurst origin={{ x: 10, y: 20, key: 2 }} onDone={() => {}} />);
    const again = document.querySelectorAll('.shuttle-burst__piece');
    expect(again).toHaveLength(BURST_COUNT);
    expect((again[0] as HTMLElement).style.left).toBe('10px');
    rerender(<ShuttleBurst origin={null} onDone={() => {}} />);
    expect(document.querySelector('.shuttle-burst')).toBeNull();
  });
});
