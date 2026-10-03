'use client';

import { useEffect, useRef, useState } from 'react';
import LaunchArt from '@/components/launch/LaunchArt';
import { isLandingUrl } from '@/lib/landingParams';
import {
  frameStyles,
  HARD_TIMEOUT_MS,
  resolveFrame,
  SETTLED_FRAME,
  shotTakeover,
  WELCOME_AT_MS,
  WELCOME_HANDOFF_MS,
  type LaunchFrame,
} from '@/lib/launchMotion';

/** Where the launch screen goes once it knows. */
export type LaunchDecision = 'welcome' | 'app' | 'none';

/**
 * READ FROM THE PAGE THE SERVER RENDERED, never from a client opinion.
 *
 * `app/page.tsx` decides who is signed in on the server and renders either
 * `SignedOutShell` (whose Welcome carries `data-signed-out-welcome`) or
 * `HomeShell` (`data-launch-app`). Both are in the HTML before any JS, so the
 * answer is in the DOM by the time this runs — and it is read AGAIN when the
 * final shot starts, because a landing can leave Welcome straight after
 * hydration, and then the screen should simply get out of the way.
 *
 * Neither marker means a route that is not the app at all — `/legal/*`,
 * `/design/*`, `/migrate`, `/auth/done` — which must not sit through a shot.
 * Nor must a LANDING (`lib/landingParams.ts`): the shells read those
 * parameters after this runs, so the URL still carries them.
 */
export function launchDecision(doc: Document, search = ''): LaunchDecision {
  if (isLandingUrl(search)) return 'none';
  if (doc.querySelector('[data-signed-out-welcome]')) return 'welcome';
  if (doc.querySelector('[data-launch-app]')) return 'app';
  return 'none';
}

/**
 * A reload is not a cold start. Signing in reloads (`reloadIntoApp`), and so do
 * the error boundaries; replaying a final shot at someone who typed their PIN
 * a second ago is the launch screen charging twice. Pull-to-refresh is not a
 * reload (it remounts the tab), so this is the browser's own.
 */
function isReload(): boolean {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}

/** The elements a frame is written to, found once rather than per frame. */
function parts(root: HTMLElement) {
  return {
    shuttle: root.querySelector<HTMLElement>('.launch-shuttle'),
    trails: Array.from(root.querySelectorAll<SVGPathElement>('.launch-trail')),
    word: root.querySelector<HTMLElement>('.launch-wordmark'),
    tag: root.querySelector<HTMLElement>('.launch-tagline'),
  };
}

function apply(p: ReturnType<typeof parts>, f: LaunchFrame) {
  const s = frameStyles(f);
  if (p.shuttle) Object.assign(p.shuttle.style, s.shuttle);
  for (const t of p.trails) Object.assign(t.style, s.trail);
  if (p.word) Object.assign(p.word.style, s.text);
  if (p.tag) Object.assign(p.tag.style, s.tagline);
}

/**
 * The cold-start screen (design handoff "BPM launch / loading screen").
 *
 * Server-rendered in the root layout, so it is on screen before any JS: the
 * loading shot loops as CSS (`<html data-launch="loading">`, `launchLoopCss`).
 * Once React hydrates, the shot becomes the final one — the shot already in
 * the air if it is still flying, the next one if it has landed (`shotTakeover`;
 * a shuttle is never cut off mid-air) — and then:
 *
 *   - signed out: the wordmark lands, and at `WELCOME_HANDOFF_MS` the screen
 *     hands over to Welcome (`data-launch="welcome"`), which draws the same
 *     lockup underneath and raises its buttons;
 *   - signed in: it leaves for Home at W;
 *   - a route that is not the app, a landing, or a reload: it leaves at once.
 *
 * While it is up it TAKES taps (no `pointer-events: none`): the page under it
 * is hydrated and live, and a tap passed through would press a button nobody
 * can see. It then UNMOUNTS rather than hiding: `visibility: hidden` keeps an
 * infinite animation running for the whole session, which this repo has paid
 * for once.
 */
export default function LaunchScreen({ tagline }: { tagline: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);
  /**
   * When the final shot started, on the `performance.now()` clock. A ref, not a
   * local: React's dev StrictMode runs this effect, cleans it up and runs it
   * again, and by the second run the CSS loop is already stopped — so "how far
   * into the shot are we?" can no longer be asked of the animation. Without
   * this the second run restarted the shot from zero and the shuttle snapped
   * back to the launch point (seen in WebKit, 27% → 0%).
   */
  const shotStart = useRef<number | null>(null);
  /** How the screen left, once it has. The same double run must not un-leave it. */
  const leftAs = useRef<'welcome' | 'done' | 'lifted' | null>(null);
  /**
   * Is this visit a landing? Read ONCE, during render: the shells consume and
   * STRIP those parameters in their own effects, so by a later effect run (or a
   * later look at the URL) the evidence is gone and the visit reads as a plain
   * launch. Seen in Chromium: `?authError=` left at once, then came back.
   */
  const [landing] = useState(() => typeof window !== 'undefined' && isLandingUrl(window.location.search));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = document.documentElement;
    const timers: number[] = [];
    let raf = 0;
    let finished = false;
    const cleanup = () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };

    const leave = (state: 'welcome' | 'done') => {
      if (finished) return;
      finished = true;
      leftAs.current = state;
      cancelAnimationFrame(raf);
      html.setAttribute('data-launch', state);
      // Unmount after the fade (globals.css: splash-out, --duration-fast).
      timers.push(window.setTimeout(() => setGone(true), 300));
    };

    // Hydration arrived after the failsafe had lifted the screen, or while it
    // was lifting it. Playing the shot now would bring the splash back over a
    // page in use, and even `done` would replay the fade from full opacity —
    // `lifted` keeps it hidden (globals.css) until it unmounts. Asked of the
    // element itself, not the clock: `performance.now()` counts from navigation
    // START, and on an Azure wake the HTML (and so the failsafe's animation)
    // arrives ~10s in. Opacity as well as visibility: through the failsafe's
    // fade the splash is still `visible` and already see-through.
    const decide = (): LaunchDecision => (landing ? 'none' : launchDecision(document));

    // Already left (a StrictMode re-run): only the unmount is still owed.
    if (leftAs.current) {
      timers.push(window.setTimeout(() => setGone(true), leftAs.current === 'lifted' ? 0 : 300));
      return cleanup;
    }

    const painted = getComputedStyle(root);
    if (painted.visibility === 'hidden' || parseFloat(painted.opacity) < 1) {
      leftAs.current = 'lifted';
      html.setAttribute('data-launch', 'lifted');
      timers.push(window.setTimeout(() => setGone(true), 0));
      return cleanup;
    }

    const first = decide();
    if (first === 'none' || isReload()) {
      leave(first === 'welcome' ? 'welcome' : 'done');
      return cleanup;
    }

    // The page owns the screen now: the CSS failsafe stands down.
    html.setAttribute('data-launch', 'resolving');
    timers.push(window.setTimeout(() => leave('done'), HARD_TIMEOUT_MS));

    const reduced = (() => {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        return false;
      }
    })();
    const canvas = root.querySelector<HTMLElement>('.launch-canvas');
    const p = parts(root);
    const loop = p.shuttle?.getAnimations?.()[0];

    /** `into`: how far into the adopted shot we already are. */
    const begin = (into: number) => {
      const decision = decide();
      if (decision === 'none') return leave('done');
      // Stop the CSS loop; the inline styles written below continue it from
      // the frame it is on (`resolveFrame(into)` IS that frame — see
      // ADOPT_UNTIL_MS).
      canvas?.classList.replace('launch-canvas--loop', 'launch-canvas--resolving');
      if (reduced) {
        // No flight: the finished lockup at once, then straight on.
        apply(p, SETTLED_FRAME);
        return leave(decision === 'welcome' ? 'welcome' : 'done');
      }
      const handoffAt = decision === 'welcome' ? WELCOME_HANDOFF_MS : WELCOME_AT_MS;
      const start = performance.now() - into;
      shotStart.current = start;
      apply(p, resolveFrame(into));
      const tick = (now: number) => {
        const ms = now - start;
        apply(p, resolveFrame(ms));
        if (ms >= handoffAt) return leave(decision === 'welcome' ? 'welcome' : 'done');
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    // Asked of the running animation every time, never assumed from a timer.
    const takeover = () => {
      if (finished) return;
      // A shot this effect already started (see `shotStart`): carry on with it.
      if (shotStart.current !== null) return begin(performance.now() - shotStart.current);
      const t = loop?.currentTime;
      const next = reduced || typeof t !== 'number' ? { adopt: 0 } : shotTakeover(t);
      if ('adopt' in next) return begin(next.adopt);
      timers.push(window.setTimeout(takeover, next.wait));
    };
    takeover();

    return cleanup;
  }, [landing]);

  if (gone) return null;
  return (
    <div ref={rootRef} className="splash launch-stage" aria-hidden="true">
      <LaunchArt tagline={tagline} variant="loop" />
    </div>
  );
}
