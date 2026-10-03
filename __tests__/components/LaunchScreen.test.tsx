// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { StrictMode, useEffect } from 'react';
import { render, cleanup, act } from '@testing-library/react';
import LaunchScreen, { launchDecision } from '@/components/launch/LaunchScreen';
import { HARD_TIMEOUT_MS, WELCOME_HANDOFF_MS } from '@/lib/launchMotion';

/* jsdom has no CSS animations, so `getAnimations` is absent and the screen
   treats the loop as sitting on a boundary — which is exactly the case these
   tests want: what happens once the shot in flight has finished. */

/** `welcome`: the signed-out Welcome. `app`: HomeShell, as the server renders it for a member. */
function mount(page?: 'welcome' | 'app') {
  const el = document.createElement(page === 'app' ? 'main' : 'div');
  if (page === 'welcome') el.setAttribute('data-signed-out-welcome', '');
  if (page === 'app') el.setAttribute('data-page-shell', '');
  document.body.appendChild(el);
  return render(<LaunchScreen tagline="Weekly badminton with your crew." />);
}

const launch = () => document.documentElement.getAttribute('data-launch');

describe('launchDecision', () => {
  afterEach(() => (document.body.innerHTML = ''));
  it('reads where the server sent this visitor', () => {
    expect(launchDecision(document)).toBe('none');
    // A signed-in member's page is ready at hydration: no final shot to sit through.
    document.body.innerHTML = '<main data-page-shell></main>';
    expect(launchDecision(document)).toBe('none');
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
    const { container } = mount('welcome');
    expect(container.querySelector('.splash .launch-canvas .launch-shuttle img')).not.toBeNull();
    expect(container.textContent).toContain('Weekly badminton with your crew.');
  });

  it('gets straight out of the way on a route that is not the app', () => {
    const { container } = mount();
    expect(launch()).toBe('done');
    act(() => vi.advanceTimersByTime(400));
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('does not keep a signed-in member waiting: the app is ready, so it leaves at hydration', () => {
    // "its done loading faster than 1.5s" — a final shot here was a wait, not a loader.
    const { container } = mount('app');
    expect(launch()).toBe('done');
    expect(container.querySelector('.launch-canvas--resolving')).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    // Unmounted, not hidden: nothing keeps animating for the session.
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('hands a signed-out visitor to Welcome once the lockup has landed', () => {
    const { container } = mount('welcome');
    expect(launch()).toBe('resolving');
    expect(container.querySelector('.launch-canvas--resolving')).not.toBeNull();
    act(() => vi.advanceTimersByTime(WELCOME_HANDOFF_MS - 100));
    expect(launch()).toBe('resolving');
    act(() => vi.advanceTimersByTime(200));
    expect(launch()).toBe('welcome');
    act(() => vi.advanceTimersByTime(400));
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('re-reads the page when the final shot starts: a view that left Welcome skips it', () => {
    // Hydration lands on a shot that has to be waited out; Welcome is gone by the time it has.
    let t = 1500;
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: () => [
        {
          get currentTime() {
            return t;
          },
        },
      ],
    });
    try {
      mount('welcome');
      expect(launch()).toBe('resolving');
      document.querySelector('[data-signed-out-welcome]')!.remove();
      t = 2000;
      act(() => vi.advanceTimersByTime(500));
      expect(launch()).toBe('done');
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it('asks the element, not the clock: a slow first byte is not a lifted splash', () => {
    now = 20_000; // navigation started 20s ago (an Azure wake), HTML just arrived
    mount('welcome');
    expect(launch()).toBe('resolving');
  });

  it('gets out of the way of an auth landing, which has a toast or a sheet to show', () => {
    for (const q of ['?authError=denied', '?verified=1', '?authFlow=name', '?join=abc', '?reset=t']) {
      window.history.replaceState(null, '', q);
      document.body.innerHTML = '<div data-signed-out-welcome></div>';
      expect(launchDecision(document, window.location.search)).toBe('none');
    }
    window.history.replaceState(null, '', '/');
  });

  it('never covers the app for good, even if the frames stop', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    mount('welcome');
    act(() => vi.advanceTimersByTime(HARD_TIMEOUT_MS + 10));
    expect(launch()).toBe('done');
  });

  /** What the browser would report for the splash's own paint. */
  function paintedAs(style: Partial<CSSStyleDeclaration>) {
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, p) => {
      const cs = real(el, p);
      return (el as Element).classList?.contains('splash') ? ({ ...cs, ...style } as CSSStyleDeclaration) : cs;
    });
  }

  it('does not bring back a splash the failsafe already lifted', () => {
    paintedAs({ visibility: 'hidden' });
    const { container } = mount('welcome');
    expect(launch()).toBe('lifted');
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.splash')).toBeNull();
  });

  it('nor one the failsafe is halfway through lifting', () => {
    // Through the fade the splash is still `visible`, and already see-through.
    paintedAs({ visibility: 'visible', opacity: '0.5' });
    mount('welcome');
    expect(launch()).toBe('lifted');
  });

  it('a reload is not a cold start: Welcome gets no final shot either', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([{ type: 'reload' } as unknown as PerformanceEntry]);
    const { container } = mount('welcome');
    expect(launch()).toBe('welcome');
    expect(container.querySelector('.launch-canvas--resolving')).toBeNull();
  });

  it('adopts the shot in flight instead of waiting for the next one', () => {
    // 600ms into a loading shot at hydration: the final shot is that shot.
    const getAnimations = vi.fn(() => [{ currentTime: 600 }]);
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', { configurable: true, value: getAnimations });
    try {
      mount('welcome');
      act(() => vi.advanceTimersByTime(WELCOME_HANDOFF_MS - 600 - 100));
      expect(launch()).toBe('resolving');
      act(() => vi.advanceTimersByTime(200));
      expect(launch()).toBe('welcome');
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it('a landing stays left, even after the shell strips its parameter from the URL', () => {
    // The shell's own effect consumes `?authError=` and strips it. Under
    // StrictMode this screen's effect then runs AGAIN, against a clean URL.
    function Shell() {
      useEffect(() => {
        window.history.replaceState(null, '', '/');
      }, []);
      return <div data-signed-out-welcome />;
    }
    window.history.replaceState(null, '', '?authError=denied');
    try {
      const { container } = render(
        <StrictMode>
          <LaunchScreen tagline="t" />
          <Shell />
        </StrictMode>,
      );
      expect(window.location.search).toBe('');
      expect(launch()).toBe('done');
      act(() => vi.advanceTimersByTime(400));
      expect(container.querySelector('.splash')).toBeNull();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('survives StrictMode running the effect twice: the adopted shot is not restarted', () => {
    // As in a browser: once the loop class is gone, so is the CSS animation.
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value(this: HTMLElement) {
        return this.closest('.launch-canvas--loop') ? [{ currentTime: 600 }] : [];
      },
    });
    try {
      const page = document.createElement('div');
      page.setAttribute('data-signed-out-welcome', '');
      document.body.appendChild(page);
      const { container } = render(
        <StrictMode>
          <LaunchScreen tagline="t" />
        </StrictMode>,
      );
      // 600ms into the flight, not back at the launch point.
      const shuttle = container.querySelector<HTMLElement>('.launch-shuttle')!;
      expect(parseFloat(shuttle.style.offsetDistance)).toBeGreaterThan(50);
      act(() => vi.advanceTimersByTime(WELCOME_HANDOFF_MS - 600 + 100));
      expect(launch()).toBe('welcome');
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it('waits out a shot that has already landed, and re-reads the clock when the wait ends', () => {
    let t = 1500; // landed, fading: not adoptable
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      // A real Animation's currentTime is live, so the mock's must be too.
      value: () => [
        {
          get currentTime() {
            return t;
          },
        },
      ],
    });
    try {
      const { container } = mount('welcome');
      expect(container.querySelector('.launch-canvas--loop')).not.toBeNull();
      // The timer fires LATE: the loop is already 120ms into the next shot.
      t = 2120;
      act(() => vi.advanceTimersByTime(500));
      expect(container.querySelector('.launch-canvas--resolving')).not.toBeNull();
      // Adopted at 120ms in, so the shuttle is where the loop left it, not back at launch.
      const shuttle = container.querySelector<HTMLElement>('.launch-shuttle')!;
      expect(parseFloat(shuttle.style.offsetDistance)).toBeGreaterThan(10);
    } finally {
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    }
  });

  it('under reduced motion, skips the flight and leaves at once', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    mount('welcome');
    act(() => vi.advanceTimersByTime(1));
    expect(launch()).toBe('welcome');
  });
});
