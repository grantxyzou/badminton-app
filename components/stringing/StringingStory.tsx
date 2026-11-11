'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { racketBareSrc, racketSrc } from '@/lib/racketLook';
import { stringPackSrc } from '@/lib/stringPackSrc';

/**
 * "Your racket, step by step" (Stringing canvas, "Racket and string animation
 * for stringing progress", 2026-11-05). Grant: "Now that we have strings and
 * racket asset can we make it into a step by step animation when user send in
 * an request? Racket goes on to [the] machine > stringing through a racket >
 * off machine > tada", and "add when the string package tears open at the top
 * string comes out".
 *
 * Plays ONCE on the "Request sent" screen, in the member's own racket and
 * string at the tension they asked for, then holds its last frame. Five steps
 * over twelve seconds:
 *
 *   1. the packet's top tears off and the string comes out;
 *   2. the BARE frame (`racketBareSrc`) slides onto the machine, clamps close;
 *   3. the strung picture (`racketSrc`) is revealed across it while the
 *      tension head pulls;
 *   4. it lifts off and turns upright;
 *   5. tada, and "Ready · <string> at <tension>".
 *
 * The machine is a generic electronic stringer seen from above: no maker's
 * name or logo. All motion is CSS (`.ss-*` in globals.css), each keyframe
 * ending on the final frame with `fill-mode: both`, so the app's
 * reduced-motion rule (every animation at 0.01 ms, one iteration) shows only
 * that last frame. The scene is drawn on a fixed 420-wide stage and scaled to
 * the sheet; the captions are ordinary text outside it, so they read and
 * translate like the rest of the sheet. Decorative: the sheet's own status
 * line says what happened.
 */
export default function StringingStory({ racketId, stringId, stringName, tension }: {
  /** The racket's catalog id, or null for one typed in (the default look). */
  racketId: string | null;
  /** The string's catalog id, or null for one with no packet picture. */
  stringId: string | null;
  stringName: string;
  /** "26" or "26/28" — the figure only; the unit comes from the copy. */
  tension: string;
}) {
  const t = useTranslations('home.stringing.story');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  /** Bumped by "Play again" to remount the scene, which restarts every animation. */
  const [run, setRun] = useState(0);
  /** The step a person swiped or tapped to (0–4), held still; null while it plays. */
  const [held, setHeld] = useState<number | null>(null);
  const startedAt = useRef(0);
  const swipeFrom = useRef<number | null>(null);
  useEffect(() => { startedAt.current = Date.now(); }, [run]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / STAGE_W);
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pack = stringPackSrc(stringId);
  const steps = [
    t('open', { string: stringName }),
    t('onto'),
    t('stringing', { tension }),
    t('off'),
    t('ready'),
  ];

  /* Swipe or tap a dot to move through the steps (Grant, 2026-11-11, on the
     design canvas: "make it scrollable"). A held step pauses every animation
     at that step's moment (`.ss--held`, a negative delay), so the scene,
     caption and dots all show it; "Play again" lets it run from the start. */
  const stepNow = () => {
    if (held !== null) return held;
    const t = (Date.now() - startedAt.current) / 1000;
    const i = STEP_AT.findIndex((at, n) => t < (STEP_AT[n + 1] ?? Infinity) && t >= at - 1);
    return i < 0 ? 0 : i;
  };
  const go = (i: number) => setHeld(Math.max(0, Math.min(STEP_AT.length - 1, i)));
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => { swipeFrom.current = e.clientX; },
    onPointerUp: (e: React.PointerEvent) => {
      const from = swipeFrom.current;
      swipeFrom.current = null;
      if (from === null) return;
      const dx = e.clientX - from;
      if (Math.abs(dx) < SWIPE_PX) return;
      go(stepNow() + (dx < 0 ? 1 : -1));
    },
    onPointerCancel: () => { swipeFrom.current = null; },
  };

  return (
    <div
      className={`ss${held !== null ? ' ss--held' : ''}`}
      style={held !== null ? { ['--ss-at' as string]: `-${STEP_AT[held]}s` } : undefined}
    >
      <div ref={boxRef} className="ss-box" aria-hidden="true" style={{ ['--ss-k' as string]: String(scale) }} {...swipe}>
        <div key={run} className="ss-stage">
          <div className="ss-machine">
            <span className="ss-turntable" />
            <span className="ss-rail" />
            <span className="ss-post ss-post-1" />
            <span className="ss-post ss-post-2" />
            <span className="ss-post ss-post-3" />
            <span className="ss-post ss-post-4" />
            <span className="ss-clamp ss-clamp-l" />
            <span className="ss-clamp ss-clamp-r" />
            <span className="ss-head">
              <span className="ss-head-track" />
              <span className="ss-head-pull" />
              <span className="ss-head-lb">{t('lb', { tension })}</span>
            </span>
            <svg className="ss-feed-line" width="162" height="40" viewBox="0 0 162 40">
              <path className="ss-feed" d="M2 2 C 60 2, 100 38, 160 38" />
            </svg>
          </div>

          <div className="ss-racket">
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-rendered same-origin art, sized by the stage. */}
            <img src={racketBareSrc(racketId)} alt="" className="ss-racket-img" />
            {/* eslint-disable-next-line @next/next/no-img-element -- as above. */}
            <img src={racketSrc(racketId)} alt="" className="ss-racket-img ss-strung" />
          </div>

          {pack && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- as above. */}
              <img src={pack} alt="" className="ss-pack ss-pack-body" />
              {/* eslint-disable-next-line @next/next/no-img-element -- as above. */}
              <img src={pack} alt="" className="ss-pack ss-pack-top" />
            </>
          )}
          <svg className="ss-out-line" width="140" height="140" viewBox="0 0 140 140">
            <path className="ss-out" d="M60 136 C 58 110, 90 104, 84 80 C 78 56, 40 64, 46 40 C 52 16, 96 20, 100 4" />
          </svg>

          <span className="ss-burst">
            {SPARKS.map((s) => <span key={s} className={`ss-spark ss-spark-${s}`} />)}
          </span>
          <span className="ss-done">
            <span className="material-icons icon-sm" aria-hidden="true">check</span>
            {t('pill', { string: stringName, tension })}
          </span>
        </div>
      </div>

      <div key={run} className="ss-captions" aria-hidden="true">
        {steps.map((s, i) => <p key={i} className={`ss-cap ss-cap-${i + 1}`}>{s}</p>)}
      </div>
      <div className="ss-foot">
        <span key={`dots-${run}`} className="ss-dots">
          {steps.map((label, i) => (
            <button
              key={i}
              type="button"
              className="ss-dot-btn"
              aria-label={label}
              aria-pressed={held === i}
              onClick={() => go(i)}
            >
              <span className={`ss-dot ss-dot-${i + 1}`} />
            </button>
          ))}
        </span>
        <button type="button" className="link-quiet link-quiet--flush ss-again" onClick={() => { setHeld(null); setRun((n) => n + 1); }}>
          {t('again')}
        </button>
      </div>
    </div>
  );
}

/** The stage's own width; everything inside it is drawn in these units. */
const STAGE_W = 420;
const SPARKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** Seconds into the 12 s run where each step reads best: the middle of its
 *  caption's window in the `ss-cap-*` keyframes, and the last frame for tada. */
const STEP_AT = [1.2, 3.3, 6.6, 9.2, 11.99] as const;
/** How far a finger travels before a drag counts as a swipe. */
const SWIPE_PX = 40;
