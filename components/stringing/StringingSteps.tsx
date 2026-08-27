'use client';

import { useTranslations } from 'next-intl';
import type { PlayerStage } from '@/lib/stringing';

/** The four things that happen, in order, from the player's side. */
export const STEP_KEYS = ['submit', 'dropOff', 'track', 'collect'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/**
 * Which step someone is standing on.
 *
 * `null` — no job yet — is step 0: submitting IS the step they are on, not one
 * they have finished. That is why the first dot is filled on a card nobody has
 * used; it reads as "you are here", not as a completed task.
 *
 * `ready_for_you` and `done` share the last step because "pick up and pay" is
 * one errand from the player's point of view, even though the bench tracks the
 * handover and the payment separately.
 */
export function stepForStage(stage: PlayerStage | null): number {
  switch (stage) {
    case 'with_stringer':
      return 1;
    case 'being_strung':
      return 2;
    case 'ready_for_you':
    case 'done':
      return 3;
    default:
      // No job, or a stage this component has not been taught — both mean the
      // player has nothing in flight to point at, so step 0 is the honest
      // answer rather than guessing further along.
      return 0;
  }
}

/**
 * The o——o——o——o process strip.
 *
 * Horizontal because the four steps are a SEQUENCE and reading them as one
 * line is the point; stacked, they read as four unrelated facts. Labels are
 * small and wrap — four columns across a phone leaves room for about two words
 * a line, which is why the copy is short.
 *
 * All geometry lives in `.bpm-steps*` in globals.css. Nothing here hand-types
 * a pixel: the dot size and the rail thickness are tokens, and the rail
 * thickness doubles as the dot's border so the two cannot drift apart.
 */
export default function StringingSteps({ current }: { current: number }) {
  const t = useTranslations('home.stringing.steps');

  return (
    <ol className="bpm-steps" style={{ gridTemplateColumns: `repeat(${STEP_KEYS.length}, 1fr)` }}>
      {STEP_KEYS.map((key, i) => {
        const reached = i <= current;
        const here = i === current;
        const first = i === 0;
        const last = i === STEP_KEYS.length - 1;
        return (
          <li key={key} className="bpm-steps__item">
            <div className="bpm-steps__rail">
              <span
                aria-hidden="true"
                className={`bpm-steps__leg ${first ? 'bpm-steps__leg--end' : reached ? 'bpm-steps__leg--on' : ''}`}
              />
              <span
                aria-hidden="true"
                className={`bpm-steps__dot ${reached ? 'bpm-steps__dot--on' : ''}`}
              />
              <span
                aria-hidden="true"
                // The leg AHEAD only lights once this step is behind you —
                // otherwise the strip would claim progress it has not made.
                className={`bpm-steps__leg ${last ? 'bpm-steps__leg--end' : i < current ? 'bpm-steps__leg--on' : ''}`}
              />
            </div>
            <span className={`fs-2xs bpm-steps__label ${here ? 'bpm-steps__label--here' : ''}`}>
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
