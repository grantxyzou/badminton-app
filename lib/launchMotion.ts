/**
 * The launch screen's motion model (design handoff "BPM launch / loading
 * screen", `docs/plans/launch-screen.md`). Pure: every frame is a function of
 * elapsed time, so the choreography is deterministic and testable, and the
 * SAME numbers drive both halves of the screen's life:
 *
 *   - before hydration, no JS runs, so the loading shot loops as CSS keyframes
 *     sampled from `loopFrame` (`launchLoopCss`, rendered into the page);
 *   - after hydration, `LaunchScreen` takes over at a shot boundary and drives
 *     `resolveFrame` per animation frame.
 *
 * One model rather than a keyframe file and a JS copy of it, because two
 * descriptions of one motion drift, and the seam between them is exactly where
 * a drift would show: the shuttle jumping as the CSS loop hands over to JS.
 */

/** The arc, in the app icon's 1024-unit space (traced from the icon). */
export const ARC = 'M175 676 C 330 480, 520 300, 670 268 C 760 250, 790 300, 788 572';

/** The same arc in the 360px hero box, for CSS `offset-path`. */
export const ARC_PX = (() => {
  const s = 360 / 1024;
  const n = (v: number) => (v * s).toFixed(1);
  return `M${n(175)} ${n(676)} C ${n(330)} ${n(480)}, ${n(520)} ${n(300)}, ${n(670)} ${n(268)} C ${n(760)} ${n(250)}, ${n(790)} ${n(300)}, ${n(788)} ${n(572)}`;
})();

/** The trail stops short of the landing point, leaving a gap before the shuttle, as in the icon. */
export const TRAIL_END = 0.88;
/** Where the final trail's tail retracts to, so the arc starts above the `b` and never crosses the letters. */
export const TRAIL_SETTLED_START = 0.3;

/** One loading shot: fly, hold, fade the shuttle, wipe the trail. Loops while the page resolves. */
export const SHOT_MS = 2000;
/** The resolve shot's flight; the shuttle stays where it lands. */
export const RESOLVE_FLIGHT_MS = 1200;
/**
 * `W` in the handoff: when Welcome begins, measured from the start of the final
 * shot. Welcome's buttons are timed from it. (The handoff also routes a
 * signed-in launch to Home at W; this build does not play a final shot for a
 * signed-in member at all — see `launchDecision`.)
 */
export const WELCOME_AT_MS = 1400;
/** If the page never gives the screen a decision after hydration, it leaves anyway. */
export const HARD_TIMEOUT_MS = 8000;

/**
 * When a signed-out visitor's splash hands over to Welcome: once the lockup has
 * fully arrived (text in, trail retracted), not at W. Welcome draws the SETTLED
 * lockup, so leaving any earlier would crossfade a half-faded wordmark into a
 * solid one — the one swap the handoff says must not be visible.
 */
export const WELCOME_HANDOFF_MS = RESOLVE_FLIGHT_MS + 500;

/** Welcome's buttons, relative to W: Sign up then Log in, 150ms apart. (The rise itself is `launch-rise` in globals.css.) */
export const BUTTON_RISE = { delayMs: 450, staggerMs: 150 } as const;

/**
 * A Welcome button's animation delay, counted from the moment Welcome is
 * revealed — the splash's handoff, or Welcome's own mount when there was no
 * splash (Back from Sign up). Either way it lands where the handoff puts it.
 */
export function buttonDelayMs(index: number): number {
  return Math.max(0, WELCOME_AT_MS + BUTTON_RISE.delayMs + index * BUTTON_RISE.staggerMs - WELCOME_HANDOFF_MS);
}

export interface LaunchFrame {
  /** Shuttle position along the arc, 0..1. */
  fly: number;
  /** Damped wobble added to the shuttle's rotation, degrees. */
  angle: number;
  /** Shuttle opacity. */
  bird: number;
  /** Visible trail, as fractions of the arc. Empty when `trailTo - trailFrom` is ~0. */
  trailFrom: number;
  trailTo: number;
  /** Wordmark + tagline entrance, 0..1. */
  text: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const easeInOutCubic = (x: number) => {
  const c = clamp01(x);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
/** 0 before `start`, 1 after `end`, linear between. */
const ramp = (t: number, start: number, end: number) => clamp01((t - start) / (end - start));

/**
 * A shuttle's flight is not a parabola: drag kills the launch speed fast, then
 * it falls at terminal velocity. Exponential decay blended with a constant
 * term, normalised so p=1 lands exactly at the end of the arc.
 */
export function flight(p: number): number {
  const k = 4.2;
  const a = 0.62;
  const d = (x: number) => a * (1 - Math.exp(-k * x)) + (1 - a) * x;
  return d(clamp01(p)) / d(1);
}

/** Aerodynamic torque settling the cork onto the velocity: a small damped oscillation. `u` is normalised flight time. */
export function wobble(u: number): number {
  if (u <= 0) return 0;
  return 14 * Math.exp(-u / 0.12) * Math.sin((2 * Math.PI * u) / 0.16);
}

/** A loading shot at `ms` (wraps every SHOT_MS). */
export function loopFrame(ms: number): LaunchFrame {
  const t = ((ms % SHOT_MS) + SHOT_MS) % SHOT_MS;
  const flyEnd = SHOT_MS * 0.6;
  const fly = flight(t / flyEnd);
  const bird = 1 - easeOutCubic(ramp(t, flyEnd, SHOT_MS * 0.72));
  const clear = easeInOutCubic(ramp(t, SHOT_MS * 0.85, SHOT_MS));
  const trailTo = fly * TRAIL_END;
  return { fly, angle: wobble(t / flyEnd), bird, trailFrom: clear * trailTo, trailTo, text: 0 };
}

/** The resolve shot at `ms` after it starts. Settles into `SETTLED_FRAME`. */
export function resolveFrame(ms: number): LaunchFrame {
  const fly = flight(ms / RESOLVE_FLIGHT_MS);
  const trailTo = fly * TRAIL_END;
  const retract = TRAIL_SETTLED_START * easeOutCubic(ramp(ms, RESOLVE_FLIGHT_MS, RESOLVE_FLIGHT_MS + 400));
  return {
    fly,
    angle: wobble(ms / RESOLVE_FLIGHT_MS),
    bird: 1,
    trailFrom: Math.min(retract, trailTo),
    trailTo,
    text: easeOutCubic(ramp(ms, RESOLVE_FLIGHT_MS - 100, RESOLVE_FLIGHT_MS + 500)),
  };
}

/** The finished lockup: what reduced motion shows at once, and what Welcome holds. */
export const SETTLED_FRAME: LaunchFrame = {
  fly: 1,
  angle: 0,
  bird: 1,
  trailFrom: TRAIL_SETTLED_START,
  trailTo: TRAIL_END,
  text: 1,
};

/* ── Applying a frame ─────────────────────────────────────────────────────
   The trail is the handoff's dash form: `stroke-dasharray: 0 <from> <len> 300`
   on a path whose pathLength is 100. Every number is POSITIVE on purpose — the
   obvious alternative, one dash shifted by a negative `stroke-dashoffset`, is
   a value older WebKit builds ignored, which would draw the settled trail from
   the launch point, across the letters. The 300 gap is longer than the path,
   so the pattern never repeats. `.launch-trail` carries a constant
   `stroke-dashoffset: 0.001` (globals.css), which pushes the zero-length first
   dash off the start of the path; without it its round cap paints a dot at the
   launch point. An empty trail is hidden outright for the same reason. */

const f3 = (v: number) => Number(v.toFixed(3));

export interface FrameStyles {
  shuttle: { offsetDistance: string; offsetRotate: string; opacity: string };
  trail: { strokeDasharray: string; opacity: string };
  text: { opacity: string; transform: string };
  tagline: { opacity: string; transform: string };
}

export function frameStyles(f: LaunchFrame): FrameStyles {
  const len = Math.max(0, f.trailTo - f.trailFrom) * 100;
  return {
    shuttle: {
      offsetDistance: `${f3(f.fly * 100)}%`,
      offsetRotate: `auto ${f3(-90 + f.angle)}deg`,
      opacity: String(f3(f.bird)),
    },
    trail: {
      strokeDasharray: `0 ${f3(f.trailFrom * 100)} ${f3(len)} 300`,
      opacity: len < 0.05 ? '0' : '1',
    },
    text: { opacity: String(f3(f.text)), transform: `translateY(${f3(10 * (1 - f.text))}px)` },
    tagline: { opacity: String(f3(f.text)), transform: `translateY(${f3(14 * (1 - f.text))}px)` },
  };
}

/**
 * The pre-hydration loop as CSS: the keyframes, sampled from `loopFrame` at
 * evenly spaced stops with linear interpolation between them, AND the two rules
 * that run them — emitted together so the loop's period is `SHOT_MS` here and
 * nowhere else. (A `2000ms` typed into globals.css would keep running at 2s
 * after this constant moved, and the takeover below would land mid-flight.)
 * Stops, not CSS `linear()`: that easing function needs Safari 17.2, and the
 * drag curve has no cubic-bezier equivalent.
 */
export function launchLoopCss(stops = 50): string {
  const shuttle: string[] = [];
  const trail: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const pct = `${f3((i / stops) * 100)}%`;
    const s = frameStyles(loopFrame((i / stops) * SHOT_MS - (i === stops ? 0.001 : 0)));
    shuttle.push(
      `${pct}{offset-distance:${s.shuttle.offsetDistance};offset-rotate:${s.shuttle.offsetRotate};opacity:${s.shuttle.opacity}}`,
    );
    trail.push(`${pct}{stroke-dasharray:${s.trail.strokeDasharray};opacity:${s.trail.opacity}}`);
  }
  return (
    `@keyframes launch-shuttle-loop{${shuttle.join('')}}@keyframes launch-trail-loop{${trail.join('')}}` +
    `.launch-canvas--loop .launch-shuttle{animation:launch-shuttle-loop ${SHOT_MS}ms linear infinite}` +
    `.launch-canvas--loop .launch-trail{animation:launch-trail-loop ${SHOT_MS}ms linear infinite}`
  );
}

/**
 * How far into a loading shot the final shot can still be ADOPTED from it.
 *
 * A loading shot and the resolve shot are the same frames until the wordmark
 * starts to arrive: same flight, same wobble, shuttle fully visible, trail
 * from the launch point. So when the page resolves inside that window, the
 * shot already in the air simply BECOMES the final one — nothing is
 * interrupted, and nobody waits out a whole extra shot for a page that is
 * ready. Past it the shuttle has landed and is fading, and the shot has to
 * finish and clear first.
 */
export const ADOPT_UNTIL_MS = RESOLVE_FLIGHT_MS - 100;

/**
 * What to do with the running loop at `loopMs`: take the shot in flight over
 * as the resolve shot (`adopt` = how far into it we already are), or `wait`
 * for it to finish. Callers re-ask after a wait rather than trusting the
 * timer: a `setTimeout` set during hydration fires late, and a late start
 * that assumed it was on the boundary would snap the next shot back to launch.
 */
export function shotTakeover(loopMs: number): { adopt: number } | { wait: number } {
  const into = ((loopMs % SHOT_MS) + SHOT_MS) % SHOT_MS;
  return into <= ADOPT_UNTIL_MS ? { adopt: into } : { wait: SHOT_MS - into };
}
