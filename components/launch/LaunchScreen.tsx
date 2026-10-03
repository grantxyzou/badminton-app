'use client';

import { useEffect, useRef, useState } from 'react';
import LaunchArt from '@/components/launch/LaunchArt';
import {
  frameStyles,
  HARD_TIMEOUT_MS,
  msToShotBoundary,
  resolveFrame,
  SETTLED_FRAME,
  WELCOME_AT_MS,
  WELCOME_HANDOFF_MS,
  type LaunchFrame,
} from '@/lib/launchMotion';

/** URL params that mean "this visit is a landing, not a launch" — see `launchDecision`. */
const LANDING_PARAMS = ['authError', 'verified', 'signedIn', 'authFlow', 'reset', 'join', 'native'];

/** Where the launch screen goes once it knows. */
export type LaunchDecision = 'welcome' | 'app' | 'none';

/**
 * READ FROM THE PAGE THE SERVER RENDERED, never from a client opinion.
 *
 * `app/page.tsx` decides who is signed in on the server and renders either
 * `SignedOutShell` (whose Welcome carries `data-signed-out-welcome`) or
 * `HomeShell` (`data-launch-app`). Both are in the HTML before any JS, so the
 * answer is in the DOM by the time this runs — and it is read AGAIN at the shot
 * boundary, because a landing can leave Welcome straight after hydration
 * (`?join=` opens Sign up, `?reset=`, `?native=1`), and then the screen should
 * simply get out of the way.
 *
 * Neither marker means a route that is not the app at all — `/legal/*`,
 * `/design/*`, `/migrate`, `/auth/done` — which must not sit through a shot.
 */
export function launchDecision(doc: Document, search = ''): LaunchDecision {
  // A landing that carries something to SAY (a sign-in error, a verified
  // email, the name step of a new Google account) or that leaves Welcome
  // (an invite, a reset link, the native return). The page reads these after
  // this runs, so the URL still has them, and a shot played over them would
  // hide a toast for most of its life.
  const params = new URLSearchParams(search);
  if (LANDING_PARAMS.some((k) => params.has(k))) return 'none';
  if (doc.querySelector('[data-signed-out-welcome]')) return 'welcome';
  if (doc.querySelector('[data-launch-app]')) return 'app';
  return 'none';
}

function apply(root: HTMLElement, f: LaunchFrame) {
  const s = frameStyles(f);
  const shuttle = root.querySelector<HTMLElement>('.launch-shuttle');
  if (shuttle) Object.assign(shuttle.style, s.shuttle);
  root.querySelectorAll<SVGPathElement>('.launch-trail').forEach((p) => Object.assign(p.style, s.trail));
  const word = root.querySelector<HTMLElement>('.launch-wordmark');
  if (word) Object.assign(word.style, s.text);
  const tag = root.querySelector<HTMLElement>('.launch-tagline');
  if (tag) Object.assign(tag.style, s.tagline);
}

/**
 * The cold-start screen (design handoff "BPM launch / loading screen").
 *
 * Server-rendered in the root layout, so it is on screen before any JS: the
 * loading shot loops as CSS (`<html data-launch="loading">`, keyframes from
 * `loopKeyframesCss`). Once React hydrates, this waits for the shot in flight
 * to finish — never cutting a shuttle off mid-air — then:
 *
 *   - signed out: plays the resolve shot, the wordmark lands, and at
 *     `WELCOME_HANDOFF_MS` hands over to Welcome (`data-launch="welcome"`),
 *     which draws the same lockup underneath and raises its buttons;
 *   - signed in: plays the resolve shot and leaves for Home at W;
 *   - anything else: leaves at once.
 *
 * It then UNMOUNTS rather than hiding: `visibility: hidden` keeps an infinite
 * animation running for the whole session, which this repo has paid for once.
 */
export default function LaunchScreen({ tagline }: { tagline: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const html = document.documentElement;
    const timers: number[] = [];
    let raf = 0;
    let finished = false;

    const leave = (state: 'welcome' | 'done') => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      html.setAttribute('data-launch', state);
      // Unmount after the fade (globals.css: splash-out, --duration-fast).
      timers.push(window.setTimeout(() => setGone(true), 300));
    };

    // Hydration arrived after the failsafe had already lifted the screen.
    // Playing the shot now would bring the splash back over a page in use, and
    // even `done` would replay the fade from full opacity — `lifted` keeps it
    // hidden (globals.css) until it unmounts. Asked of the element itself, not
    // the clock: `performance.now()` counts from navigation START, and on an
    // Azure wake the HTML (and so the failsafe's animation) arrives ~10s in.
    if (getComputedStyle(root).visibility === 'hidden') {
      html.setAttribute('data-launch', 'lifted');
      timers.push(window.setTimeout(() => setGone(true), 0));
      return () => timers.forEach(clearTimeout);
    }

    if (launchDecision(document, window.location.search) === 'none') {
      leave('done');
      return () => timers.forEach(clearTimeout);
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

    const begin = () => {
      const decision = launchDecision(document, window.location.search);
      if (decision === 'none') return leave('done');
      // Stop the CSS loop; the inline styles written below take over from the
      // exact frame it ended on (a shot boundary: shuttle at launch, no trail).
      canvas?.classList.replace('launch-canvas--loop', 'launch-canvas--resolving');
      if (reduced) {
        // No flight: the finished lockup at once, then straight on.
        apply(root, SETTLED_FRAME);
        return leave(decision === 'welcome' ? 'welcome' : 'done');
      }
      const handoffAt = decision === 'welcome' ? WELCOME_HANDOFF_MS : WELCOME_AT_MS;
      const start = performance.now();
      const tick = (now: number) => {
        const ms = now - start;
        apply(root, resolveFrame(ms));
        if (ms >= handoffAt) return leave(decision === 'welcome' ? 'welcome' : 'done');
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    // Let the shot in flight land and its trail clear before the resolve shot.
    const loop = canvas?.querySelector('.launch-shuttle')?.getAnimations?.()[0];
    const t = loop?.currentTime;
    const wait = reduced || typeof t !== 'number' ? 0 : msToShotBoundary(t);
    timers.push(window.setTimeout(begin, wait));

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, []);

  if (gone) return null;
  return (
    <div ref={rootRef} className="splash launch-stage" aria-hidden="true">
      <LaunchArt tagline={tagline} variant="loop" />
    </div>
  );
}
