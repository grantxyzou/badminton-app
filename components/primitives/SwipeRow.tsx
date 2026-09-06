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
  const [offset, setOffset] = useState(0);
  const [revealed, setRevealed] = useState<Revealed>('none');
  const [phase, setPhase] = useState<'idle' | 'active' | 'release'>('idle');

  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const disqualified = useRef(false);

  const close = useCallback(() => {
    setRevealed('none');
    setOffset(0);
    setPhase('release');
  }, []);

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
      setOffset(0);
      setPhase('release');
      return;
    }

    const base = revealed === 'leading' ? ACTION_W : revealed === 'trailing' ? -ACTION_W : 0;
    let next = base + dx;
    // Clamp to the side that actually has an action, so a row with only one
    // action cannot be dragged open on the empty side.
    if (next > 0 && !leadingAction) next = 0;
    if (next < 0 && !trailingAction) next = 0;
    next = Math.max(-ACTION_W, Math.min(ACTION_W, next));

    if (next !== 0) setPhase('active');
    setOffset(next);
  };

  const onTouchEnd = () => {
    if (!armed.current) return;
    armed.current = false;
    if (disqualified.current) {
      start.current = null;
      return;
    }
    if (offset >= COMMIT && leadingAction) {
      setRevealed('leading');
      setOffset(ACTION_W);
    } else if (offset <= -COMMIT && trailingAction) {
      setRevealed('trailing');
      setOffset(-ACTION_W);
    } else {
      setRevealed('none');
      setOffset(0);
    }
    setPhase('release');
    start.current = null;
  };

  const fire = (action: SwipeAction) => {
    close();
    action.onAction();
  };

  return (
    <div
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

      <div
        className="swipe-row__track"
        data-swiping={phase === 'idle' ? undefined : phase}
        // Omitted entirely at rest — see the containing-block note in
        // globals.css. `undefined` here, not `translateX(0)`.
        style={offset === 0 ? undefined : { transform: `translateX(${offset}px)` }}
        onTransitionEnd={() => setPhase('idle')}
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
