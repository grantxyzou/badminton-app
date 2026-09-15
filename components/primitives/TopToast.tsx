'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { StatusTone } from './StatusBanner';

/**
 * A message that DROPS IN FROM THE TOP of the screen and leaves again.
 *
 * For MOMENTS, not states: "You're signed in", "Email confirmed", "You're
 * offline". A state that stays true while you look at it — sign-ups full, on
 * the waitlist, racket ready — belongs in its card as a `StatusBanner`, because
 * a floating message that times out would leave that card silent about what is
 * still the case.
 *
 * WHY `content` KEEPS RENDERING AFTER IT GOES NULL
 * -----------------------------------------------
 * The exit is a slide back up. If the card unmounted the instant its content
 * cleared there would be nothing left to slide, so the last content is held and
 * the card stays mounted, off-screen and `inert`, until the next one arrives.
 * Held by `id` rather than by object identity: callers build the content inline
 * on every render, and comparing objects would re-set state on every render.
 *
 * Solid surface, no border stroke (the reference Grant picked). The surface is
 * the INVERSE of the theme — near-black on the light theme, near-white on the
 * dark one — so it reads as sitting above the page in both, and the tone lives
 * in the icon alone. Tokens `--toast-*` in globals.css.
 *
 * `onClose` omitted = no ✕: for a message that clears itself when the state
 * behind it ends (offline).
 */
export interface TopToastContent {
  /** Stable per message. A different id replaces the message shown. */
  id: string;
  tone: StatusTone;
  /** Material Symbols glyph name. */
  icon: string;
  title: ReactNode;
  body?: ReactNode;
  /**
   * How long until the caller clears it, in ms. Draws the countdown: a ring
   * around the ✕ whose stroke fills in over this time and is complete the
   * moment the message leaves. The CALLER still owns the timer — this only
   * shows it — so pass the same number the caller's timeout uses, or the ring
   * finishes before or after the message does.
   */
  durationMs?: number;
}

export interface TopToastProps {
  content: TopToastContent | null;
  onClose?: () => void;
}

export default function TopToast({ content, onClose }: TopToastProps) {
  // `close` lives in the recovery namespace; sheets reuse it too.
  const t = useTranslations('recovery');
  const [shown, setShown] = useState<TopToastContent | null>(content);
  // Derived state, set during render (React's documented pattern for "keep the
  // previous value"), so the exit slide has something to show.
  if (content && content.id !== shown?.id) setShown(content);

  const open = content !== null;
  const view = content ?? shown;

  return (
    <div className="top-toast" data-open={open ? 'true' : 'false'} aria-hidden={!open} inert={!open}>
      {view && (
        <div
          className={`top-toast-card top-toast-${view.tone}`}
          role={view.tone === 'success' ? 'status' : 'alert'}
          aria-live={view.tone === 'success' ? 'polite' : 'assertive'}
        >
          <span className="material-icons top-toast-icon" aria-hidden="true">
            {view.icon}
          </span>
          <div className="top-toast-text">
            <p className="top-toast-title">{view.title}</p>
            {view.body && <p className="top-toast-body">{view.body}</p>}
          </div>
          {onClose && (
            <button type="button" className="top-toast-close" onClick={onClose} aria-label={t('close')}>
              {view.durationMs && open ? (
                /* Keyed by id so a new message restarts the ring from empty. */
                <svg
                  key={view.id}
                  className="top-toast-ring"
                  viewBox="0 0 36 36"
                  aria-hidden="true"
                  style={{ '--toast-duration': `${view.durationMs}ms` } as CSSProperties}
                >
                  <circle className="top-toast-ring-track" cx="18" cy="18" r="16" pathLength={100} />
                  <circle className="top-toast-ring-fill" cx="18" cy="18" r="16" pathLength={100} />
                </svg>
              ) : null}
              <span className="top-toast-close-dot">
                <span className="material-icons icon-sm" aria-hidden="true">
                  close
                </span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
