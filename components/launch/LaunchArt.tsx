import { ARC, ARC_PX, frameStyles, loopFrame, SETTLED_FRAME } from '@/lib/launchMotion';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const SHUTTLE_SRC = `${BASE}/brand/launch/shuttle.png`;

interface Props {
  tagline: string;
  /**
   * `loop`: the cold-start loader — CSS keyframes play the loading shot until
   * `LaunchScreen` takes over. `settled`: the finished lockup, Welcome's.
   */
  variant: 'loop' | 'settled';
}

/**
 * The launch lockup: the app icon's shot trajectory, the shuttle that flies it,
 * and `bpm` with its tagline — drawn on the handoff's fixed 360×740 canvas and
 * scaled to fit (`--launch-k`, set before first paint in `app/layout.tsx`),
 * never reflowed.
 *
 * ONE component for both the splash and Welcome, so the two are the same
 * pixels by construction: the splash can leave and reveal Welcome without a
 * visible swap — the handoff's "nothing is swapped between the two states".
 * Geometry and colour live in globals.css under "Launch screen"; the per-frame
 * values come from `lib/launchMotion.ts`, and a controller finds the parts it
 * animates by their class names.
 */
export default function LaunchArt({ tagline, variant }: Props) {
  const s = frameStyles(variant === 'loop' ? loopFrame(0) : SETTLED_FRAME);
  return (
    // The splash is decoration over a page that is loading; Welcome's lockup is
    // the only place that screen says what app this is, so it is named.
    <div
      className={`launch-canvas launch-canvas--${variant}`}
      {...(variant === 'loop' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': `bpm. ${tagline}` })}
    >
      <div className="launch-hero">
        <svg viewBox="0 0 1024 1024" className="launch-arc">
          <path className="launch-trail launch-trail--tube" d={ARC} pathLength={100} style={s.trail} />
          <path
            className="launch-trail launch-trail--glint"
            d={ARC}
            pathLength={100}
            transform="translate(-9 -11)"
            style={s.trail}
          />
        </svg>
        <div className="launch-shuttle" style={{ offsetPath: `path('${ARC_PX}')`, ...s.shuttle }}>
          {/* A plain <img>: next/image adds a wrapper and a client loader to an
              element that has to paint before any JS has run. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SHUTTLE_SRC} alt="" width={77} height={72} fetchPriority="high" />
        </div>
      </div>
      <div className="launch-lockup">
        <span className="launch-wordmark" style={s.text}>
          bpm
        </span>
        <p className="launch-tagline" style={s.tagline}>
          {tagline}
        </p>
      </div>
    </div>
  );
}
