'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A list row whose actions are uncovered by a horizontal drag.
 *
 * THE RULE: the gesture REVEALS, the tap COMMITS. Swipe-to-commit is not
 * offered — an accidental drag would archive somebody's job, and there is no
 * hover state to warn with. See the `.swipe-row` block in globals.css for the
 * principle this is built on.
 *
 * Hand-rolled, deliberately. This repo has no gesture library and should not
 * gain one for two buttons: both existing gestures (`TopBar`'s swipe-back and
 * `PullToRefresh`) are raw TouchEvent listeners, and matching them keeps the
 * three coordinating rather than competing.
 *
 * THREE THINGS IT MUST NOT FIGHT
 * ------------------------------
 * 1. `TopBar` arms swipe-back from the left 24px, and WKWebView / the Capacitor
 *    shell own that edge for the system back gesture. So this refuses to arm
 *    inside `EDGE_GUARD` — a swipe that starts at the edge is never ours.
 * 2. `PullToRefresh` listens on `document` and already forfeits a drag once
 *    horizontal travel beats vertical by its own slop, so the coordination is
 *    one-way and needs no change there. This mirrors the same test in the
 *    opposite direction.
 * 3. A BottomSheet locks the body with `position: fixed`; while one is open the
 *    row underneath must not respond. Same probe `PullToRefresh` uses.
 *
 * TOUCH ONLY, AND THAT IS FINE. There is no mouse-drag path: on a desktop the
 * row's `more_vert` menu carries every action this does. For the same reason
 * the revealed buttons are `aria-hidden` and out of the tab order — they are a
 * pointer shortcut, and duplicating them as tab stops would make a keyboard
 * user visit each action twice.
 */

/** Below this from the left edge the gesture belongs to swipe-back / the OS. */
const EDGE_GUARD = 32;
/** Vertical travel beyond this, and beating horizontal, means it was a scroll. */
const V_SLOP = 12;
/** How far the finger must travel before a reveal sticks on release. */
const COMMIT = 44;
/** Width of one action button. Matches `.swipe-row__action` in globals.css. */
const ACTION_W = 88;

export interface SwipeAction {
  icon: string;
  label: string;
  tone: 'accent' | 'neutral' | 'danger';
  onAction: () => void;
}

interface Props {
  children: React.ReactNode;
  /** Uncovered by swiping RIGHT. Sits on the left. */
  leadingAction?: SwipeAction;
  /** Uncovered by swiping LEFT. Sits on the right. */
  trailingAction?: SwipeAction;
  /** Gestures are ignored entirely when false — e.g. offline. */
  enabled?: boolean;
}

type Revealed = 'none' | 'leading' | 'trailing';

export default function SwipeRow({
  children,
  leadingAction,
  trailingAction,
  enabled = true,
}: Props) {
  const [revealed, setRevealed] = useState<Revealed>('none');

  const rowRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const disqualified = useRef(false);
  /* The live offset. A REF, not state — see `paint()`. */
  const offset = useRef(0);

  /**
   * THE DRAG DOES NOT RE-RENDER.
   *
   * `offset` used to be React state written on every `touchmove`, so the row
   * re-rendered every frame of the gesture — which is what made it feel
   * sticky. `TopBar`'s swipe-back solved this before this component existed:
   * it writes a CSS custom property and gates the transform on a
   * `data-swiping` attribute, with no React state during the drag at all. This
   * is that, applied to a row.
   *
   * The attribute earns its keep twice. It also gates the action tray's
   * visibility — see `.swipe-row` in globals.css for why that matters.
   */
  const paint = useCallback((px: number, phase: 'active' | 'release' | null) => {
    offset.current = px;
    const el = rowRef.current;
    if (!el) return;
    el.style.setProperty('--swipe-x', `${px}px`);
    if (phase) el.setAttribute('data-swiping', phase);
    else el.removeAttribute('data-swiping');
  }, []);

  /**
   * Settle to rest WITHOUT relying on a transition.
   *
   * `paint(0, 'release')` leaves `data-swiping="release"` on the row and waits
   * for `transitionend` to clear it. Under `prefers-reduced-motion: reduce` the
   * CSS sets `transition: none`, so that event never fires and the attribute
   * sticks — which re-shows the action tray permanently and reintroduces the
   * exact backdrop-filter glow this component was just fixed for, plus a
   * permanent identity transform on the track (the containing-block trap).
   *
   * When the offset is already zero there is nothing to animate back from, so
   * clear it outright.
   */
  const settle = useCallback(() => {
    paint(0, null);
  }, [paint]);

  const close = useCallback(() => {
    setRevealed('none');
    settle();
  }, [settle]);

  // Escape closes an open reveal, matching every other dismissible surface.
  useEffect(() => {
    if (revealed === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [revealed, close]);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!enabled) return;
    // A sheet is open and has locked the body — the row beneath is not
    // interactive, however much it looks like it is.
    if (typeof document !== 'undefined' && document.body.style.position === 'fixed') return;
    const t = e.touches[0];
    if (!t) return;
    // Not ours: swipe-back and the OS back gesture both live at the left edge.
    if (t.clientX <= EDGE_GUARD) return;
    start.current = { x: t.clientX, y: t.clientY };
    armed.current = true;
    disqualified.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!armed.current || disqualified.current || !start.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;

    // Vertical wins: this was a scroll all along. Give it up for the whole
    // gesture rather than re-testing each frame, so a wobbly finger cannot
    // flip a scroll into a reveal halfway down the page.
    if (Math.abs(dy) > V_SLOP && Math.abs(dy) > Math.abs(dx)) {
      disqualified.current = true;
      // A vertical scroll that began on a row. Nothing to animate back from.
      settle();
      return;
    }

    const base = revealed === 'leading' ? ACTION_W : revealed === 'trailing' ? -ACTION_W : 0;
    let next = base + dx;
    // Clamp to the side that actually has an action, so a row with only one
    // action cannot be dragged open on the empty side.
    if (next > 0 && !leadingAction) next = 0;
    if (next < 0 && !trailingAction) next = 0;
    next = Math.max(-ACTION_W, Math.min(ACTION_W, next));

    paint(next, next !== 0 ? 'active' : null);
  };

  const onTouchEnd = () => {
    if (!armed.current) return;
    armed.current = false;
    if (disqualified.current) {
      start.current = null;
      return;
    }
    const settled = offset.current;
    if (settled >= COMMIT && leadingAction) {
      setRevealed('leading');
      paint(ACTION_W, 'release');
    } else if (settled <= -COMMIT && trailingAction) {
      setRevealed('trailing');
      paint(-ACTION_W, 'release');
    } else {
      setRevealed('none');
      settle();
    }
    start.current = null;
  };

  const fire = (action: SwipeAction) => {
    close();
    action.onAction();
  };

  return (
    <div
      ref={rowRef}
      className="swipe-row"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className="swipe-row__actions" aria-hidden="true">
        {leadingAction ? (
          <button
            type="button"
            tabIndex={-1}
            className={`swipe-row__action swipe-row__action--${leadingAction.tone}`}
            onClick={() => fire(leadingAction)}
          >
            <span className="material-icons icon-sm">{leadingAction.icon}</span>
            {leadingAction.label}
          </button>
        ) : (
          <span />
        )}
        {trailingAction ? (
          <button
            type="button"
            tabIndex={-1}
            className={`swipe-row__action swipe-row__action--${trailingAction.tone}`}
            onClick={() => fire(trailingAction)}
          >
            <span className="material-icons icon-sm">{trailingAction.icon}</span>
            {trailingAction.label}
          </button>
        ) : (
          <span />
        )}
      </div>

      {/* No inline transform, and no `data-swiping` of its own: both now live
          on the row root, written imperatively by `paint()`. The CSS reads
          `--swipe-x` and applies the transform ONLY while the attribute is
          present, which keeps the containing-block discipline intact — a
          `translateX(0)` at rest would establish a containing block and break
          `position: fixed` descendants. */}
      <div
        className="swipe-row__track"
        onTransitionEnd={() => {
          if (offset.current === 0) paint(0, null);
        }}
      >
        {/* While an action is uncovered, a tap on the row closes it rather than
            opening the row. The first tap after a gesture is a dismissal — that
            is what every sheet in the app does, and doing otherwise means a
            mis-swipe navigates you somewhere you did not ask to go. */}
        {revealed !== 'none' && (
          <div
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
              close();
            }}
            style={{ position: 'absolute', inset: 0, zIndex: 1 }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
