import type { ReactNode } from 'react';

/**
 * Load-error message — the canonical "couldn't load" state. Centralizes the
 * `role="alert"` contract the "legible-fail" rule needs: a failed fetch must
 * NOT render as a confident empty state.
 *
 * Replaces:  <p className="field-error" role="alert">{msg}</p>
 * With:      <ErrorState message={msg} />
 *
 * ## Two shapes
 *
 * **Standing** (`action` given, usually "Try again") — a glyph over the
 * centred message, then the button: the same icon-and-text layout as a
 * standing `<EmptyState>`. It is NEUTRAL, not red (Grant, 2026-11-11, on the
 * design canvas: "should not be red"). A card that could not reach the
 * server has not been told no; the person did nothing wrong and the next tap
 * will probably work, so it reads as a state, not an alarm. The glyph
 * (`cloud_off`) and the words say it failed; `role="alert"` says it to a
 * screen reader.
 *
 * **Inline** (no `action`) — the red `.field-error` line, for a failure
 * inside a card that has other content around it.
 *
 * Red is kept for something the person did or must fix — a wrong PIN, a form
 * error, a refused sign-up (`.field-error` / `.field-warn` at the call site).
 */
export interface ErrorStateProps {
  message: ReactNode;
  /**
   * A way out — usually "Try again" as a `cc-btn cc-btn-ghost`. Giving one
   * switches to the standing layout above.
   */
  action?: ReactNode;
}

export default function ErrorState({ message, action }: ErrorStateProps) {
  if (action) {
    return (
      <div className="error-state">
        <span className="material-icons icon-xl error-state__icon" aria-hidden="true">
          cloud_off
        </span>
        <p className="error-state__message" role="alert">
          {message}
        </p>
        {action}
      </div>
    );
  }
  return (
    <p className="field-error" role="alert" style={{ margin: '0' }}>
      {message}
    </p>
  );
}
