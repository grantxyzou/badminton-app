import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  ARC_PX,
  buttonDelayMs,
  flight,
  frameStyles,
  loopFrame,
  launchLoopCss,
  resolveFrame,
  ADOPT_UNTIL_MS,
  RESOLVE_FLIGHT_MS,
  SETTLED_FRAME,
  shotTakeover,
  SHOT_MS,
  TRAIL_END,
  TRAIL_SETTLED_START,
  WELCOME_AT_MS,
  WELCOME_HANDOFF_MS,
  wobble,
} from '@/lib/launchMotion';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('the flight profile', () => {
  it('starts at the launch point and lands exactly at the end of the arc', () => {
    expect(flight(0)).toBe(0);
    expect(close(flight(1), 1)).toBe(true);
    expect(flight(-1)).toBe(0);
    expect(close(flight(2), 1)).toBe(true);
  });

  it('is drag, not a parabola: most of the distance is covered early', () => {
    // A constant-speed flight is at 0.5 halfway; this one is well past it.
    expect(flight(0.5)).toBeGreaterThan(0.6);
    for (let p = 0.05; p <= 1; p += 0.05) expect(flight(p)).toBeGreaterThan(flight(p - 0.05));
  });

  it('settles the wobble to nothing by the landing', () => {
    expect(wobble(0)).toBe(0);
    expect(Math.abs(wobble(1))).toBeLessThan(0.01);
  });
});

describe('a loading shot', () => {
  it('begins and ends empty, so shots loop with no seam', () => {
    const start = loopFrame(0);
    expect(start.fly).toBe(0);
    expect(start.bird).toBe(1);
    expect(start.trailTo - start.trailFrom).toBe(0);
    const end = loopFrame(SHOT_MS - 0.001);
    expect(end.bird).toBeLessThan(0.001);
    expect(end.trailTo - end.trailFrom).toBeLessThan(0.001);
  });

  it('stops the trail short of the shuttle', () => {
    const landed = loopFrame(SHOT_MS * 0.6);
    expect(close(landed.fly, 1)).toBe(true);
    expect(close(landed.trailTo, TRAIL_END)).toBe(true);
  });

  it('wipes the trail tail-first', () => {
    const mid = loopFrame(SHOT_MS * 0.92);
    expect(mid.trailFrom).toBeGreaterThan(0);
    expect(close(mid.trailTo, TRAIL_END)).toBe(true);
  });

  it('wraps', () => {
    expect(loopFrame(SHOT_MS * 2 + 300)).toEqual(loopFrame(300));
  });
});

describe('the resolve shot', () => {
  it('takes over from a shot boundary without a jump', () => {
    expect(resolveFrame(0)).toEqual({ ...loopFrame(0), angle: 0 });
  });

  it('keeps the shuttle, retracts the trail clear of the letters, and lands in the settled lockup', () => {
    const late = resolveFrame(5000);
    expect(late.bird).toBe(1);
    expect(close(late.trailFrom, TRAIL_SETTLED_START)).toBe(true);
    expect(close(late.fly, SETTLED_FRAME.fly)).toBe(true);
    expect(late.text).toBe(1);
  });

  it('has fully arrived by the Welcome handoff, so the swap to Welcome is invisible', () => {
    const f = resolveFrame(WELCOME_HANDOFF_MS);
    expect(f.text).toBe(1);
    expect(close(f.trailFrom, SETTLED_FRAME.trailFrom)).toBe(true);
  });
});

describe('Welcome buttons', () => {
  it('land where the handoff puts them: W+450 and W+600', () => {
    expect(WELCOME_HANDOFF_MS + buttonDelayMs(0)).toBe(WELCOME_AT_MS + 450);
    expect(WELCOME_HANDOFF_MS + buttonDelayMs(1)).toBe(WELCOME_AT_MS + 600);
  });
});

describe('frame styles', () => {
  it('hides an empty trail outright (a zero-length dash still paints its round cap)', () => {
    expect(frameStyles(loopFrame(0)).trail.opacity).toBe('0');
    expect(frameStyles(SETTLED_FRAME).trail).toEqual({ strokeDasharray: '0 30 58 300', opacity: '1' });
  });

  it('never writes a negative dash value (older WebKit ignored a negative dashoffset)', () => {
    for (let ms = 0; ms < SHOT_MS; ms += 37) {
      for (const f of [loopFrame(ms), resolveFrame(ms)]) {
        const t = frameStyles(f).trail;
        expect(t.strokeDasharray).not.toContain('-');
        expect(t).not.toHaveProperty('strokeDashoffset');
      }
    }
  });

  it('matches what globals.css hardcodes for the same picture', () => {
    const css = readFileSync('app/globals.css', 'utf8');
    // Reduced motion's settled trail, and the constant offset the dash form needs.
    expect(css).toContain('stroke-dasharray: 0 30 58 300 !important');
    expect(css).toMatch(/\.launch-trail\s*\{[^}]*stroke-dashoffset: 0\.001/);
    expect(css).not.toMatch(/stroke-dashoffset:\s*-/);
  });
});

describe('the pre-hydration loop CSS', () => {
  const css = launchLoopCss();
  it('defines both loops with a first and last stop', () => {
    expect(css).toContain('@keyframes launch-shuttle-loop{0%{');
    expect(css).toContain('@keyframes launch-trail-loop{0%{');
    expect(css).toMatch(/100%\{offset-distance:/);
  });

  it('runs them at SHOT_MS, and globals.css does not run them a second way', () => {
    expect(css).toContain(`.launch-canvas--loop .launch-shuttle{animation:launch-shuttle-loop ${SHOT_MS}ms linear infinite}`);
    expect(css).toContain(`.launch-canvas--loop .launch-trail{animation:launch-trail-loop ${SHOT_MS}ms linear infinite}`);
    const globals = readFileSync('app/globals.css', 'utf8');
    expect(globals).not.toMatch(/animation:\s*launch-(shuttle|trail)-loop/);
  });

  it('uses no linear() easing (Safari < 17.2)', () => {
    expect(css).not.toContain('linear(');
  });

  it('is plain CSS a <style> can carry', () => {
    expect(css).not.toMatch(/[<&]/);
  });
});

describe('taking the loop over', () => {
  it('adopts a shot still in flight, from exactly where it is', () => {
    expect(shotTakeover(0)).toEqual({ adopt: 0 });
    expect(shotTakeover(500)).toEqual({ adopt: 500 });
    expect(shotTakeover(SHOT_MS * 3 + 500)).toEqual({ adopt: 500 });
    expect(shotTakeover(ADOPT_UNTIL_MS)).toEqual({ adopt: ADOPT_UNTIL_MS });
  });

  it('waits out a shot that has landed', () => {
    expect(shotTakeover(1500)).toEqual({ wait: 500 });
    expect(shotTakeover(SHOT_MS - 5)).toEqual({ wait: 5 });
  });

  it('is seamless: across the whole adoption window the two shots are the same frame', () => {
    // If these ever differ, adopting a shot mid-flight would visibly jump.
    for (let ms = 0; ms <= ADOPT_UNTIL_MS; ms += 25) {
      expect(frameStyles(resolveFrame(ms))).toEqual(frameStyles(loopFrame(ms)));
    }
    expect(ADOPT_UNTIL_MS).toBeLessThan(RESOLVE_FLIGHT_MS);
  });
});

it('scales the arc into the 360px hero box', () => {
  expect(ARC_PX.startsWith('M61.5 237.7 C 116.0 168.8')).toBe(true);
  expect(ARC_PX.endsWith('277.0 201.1')).toBe(true);
});
