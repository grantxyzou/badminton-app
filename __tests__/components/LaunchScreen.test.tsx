// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import LaunchScreen, { launchDecision } from '@/components/launch/LaunchScreen';
import { HARD_TIMEOUT_MS, WELCOME_AT_MS, WELCOME_HANDOFF_MS } from '@/lib/launchMotion';

/* jsdom has no CSS animations, so `getAnimations` is absent and the screen
   treats the loop as sitting on a boundary — which is exactly the case these
   tests want: what happens once the shot in flight has finished. */

function mount(marker?: 'data-signed-out-welcome' | 'data-launch-app') {
  const page = document.createElement('div');
  if (marker) page.setAttribute(marker, '');
  document.body.appendChild(page);
  return render(<LaunchScreen tagline="Weekly badminton with your crew." />);
}

const launch = () => document.documentElement.getAttribute('data-launch');

describe('launchDecision', () => {
  afterEach(() => (document.body.innerHTML = ''));
  it('reads where the server sent this visitor', () => {
    expect(launchDecision(document)).toBe('none');
    document.body.innerHTML = '<main data-launch-app></main>';
    expect(launchDecision(document)).toBe('app');
    document.body.innerHTML = '<div data-signed-out-welcome></div>';
    expect(launchDecision(document)).toBe('welcome');
  });
});

describe('LaunchScreen', () => {
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => {
        now += 16;
        cb(now);
      }, 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    document.documentElement.setAttribute('data-launch', 'loading');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders the shot artwork on the server-rendered splash', () => {
    const { container } = mount('data-launch-app');
    expect(container.querySelector('.splash .launch-canvas--loop .launch-shuttle img')).not.toBeNull();
    expect(container.textContent).toContain('Weekly badminton with your crew.');
  });

  it('gets straight out of the way on a route that is not the app', () => {
    const { container } = mount();
    expect(launch()).toBe('done');
    act(() => vi.advanceTimersByTime(400));
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('plays the resolve shot for a member, then leaves for Home at W', () => {
    const { container } = mount('data-launch-app');
    expect(launch()).toBe('resolving');
    act(() => vi.advanceTimersByTime(WELCOME_AT_MS - 100));
    expect(launch()).toBe('resolving');
    expect(container.querySelector('.launch-canvas--resolving')).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(launch()).toBe('done');
    act(() => vi.advanceTimersByTime(400));
    // Unmounted, not hidden: nothing keeps animating for the session.
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('hands a signed-out visitor to Welcome once the lockup has landed', () => {
    mount('data-signed-out-welcome');
    act(() => vi.advanceTimersByTime(WELCOME_HANDOFF_MS - 100));
    expect(launch()).toBe('resolving');
    act(() => vi.advanceTimersByTime(200));
    expect(launch()).toBe('welcome');
  });

  it('re-reads the page at the boundary: a landing that left Welcome skips the shot', () => {
    mount('data-signed-out-welcome');
    document.querySelector('[data-signed-out-welcome]')!.remove();
    act(() => vi.advanceTimersByTime(20));
    expect(launch()).toBe('done');
  });

  it('never covers the app for good, even if the frames stop', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    mount('data-launch-app');
    act(() => vi.advanceTimersByTime(HARD_TIMEOUT_MS + 10));
    expect(launch()).toBe('done');
  });

  it('does not bring back a splash the failsafe already lifted', () => {
    now = 20_000;
    const { container } = mount('data-launch-app');
    expect(launch()).toBe('lifted');
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('under reduced motion, skips the flight and leaves at once', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    mount('data-signed-out-welcome');
    act(() => vi.advanceTimersByTime(1));
    expect(launch()).toBe('welcome');
  });
});
