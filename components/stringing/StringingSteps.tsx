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
 * they have finished. That is why the first circle is filled on a card nobody
 * has used: it reads as "you are here", not as a completed task.
 *
 * `ready_for_you` and `done` share the last step because "pick up and pay" is
 * one errand from the player's point of view, even though the bench tracks the
 * handover and the payment separately.
 */
export function stepForStage(stage: PlayerStage | null): number {
  switch (stage) {
    case null:
      return 0;
    case 'with_stringer':
      return 1;
    case 'being_strung':
      return 2;
    case 'ready_for_you':
    case 'done':
      return 3;
  }
}

/**
 * The o—o—o—o process strip.
 *
 * Horizontal because the four steps are a SEQUENCE and reading them as one
 * line is the point; a vertical list would read as four separate facts. The
 * labels are small and wrap — at four columns across a phone there is room for
 * about two words a line, which is why the copy is short.
 *
 * The connecting line is drawn between circles rather than under them, so a
 * completed leg can be tinted independently of the step it leads to.
 */
export default function StringingSteps({ current }: { current: number }) {
  const t = useTranslations('home.stringing.steps');

  return (
    <ol
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${STEP_KEYS.length}, 1fr)`,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {STEP_KEYS.map((key, i) => {
        const done = i < current;
        const here = i === current;
        const colour = done || here ? 'var(--accent)' : 'var(--text-muted)';
        return (
          <li key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                // The legs must reach the neighbouring circles, so the row is
                // full-width and the connectors flex into the gaps.
                justifyContent: 'center',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  background: i === 0 ? 'transparent' : done || here ? 'var(--accent)' : 'var(--divider)',
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  flex: '0 0 auto',
                  borderRadius: 'var(--radius-pill)',
                  border: `2px solid ${colour}`,
                  // Filled for where you are AND what you have passed; hollow
                  // for what is still ahead.
                  background: done || here ? 'var(--accent)' : 'transparent',
                }}
              />
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  background:
                    i === STEP_KEYS.length - 1 ? 'transparent' : done ? 'var(--accent)' : 'var(--divider)',
                }}
              />
            </div>
            <span
              className="fs-2xs"
              style={{
                marginTop: 'var(--space-2)',
                textAlign: 'center',
                lineHeight: 'var(--lh-snug)',
                color: here ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: here ? 600 : 400,
                paddingInline: 2,
              }}
            >
              {t(key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
