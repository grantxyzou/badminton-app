import type { ReactNode } from 'react';

/**
 * Load-error pill — the canonical "couldn't load" message. Centralizes the
 * `role="alert"` contract and the error styling that was hand-written ~50×
 * across stats/admin cards (the "legible-fail" rule: a failed fetch must NOT
 * render as a confident empty state). One place to restyle the error tone.
 *
 * Replaces:  <p className="field-error" role="alert">{msg}</p>
 * With:      <ErrorState message={msg} />
 */
export interface ErrorStateProps {
  message: ReactNode;
  /**
   * A way out — usually "Try again" as a `cc-btn cc-btn-ghost`. With one, the
   * message stands centred with the button beneath it, the same standing
   * layout `<EmptyState>` uses, so a card saying "that failed" and a card
   * saying "nothing here" are placed alike and differ only in colour. Red
   * stays: this is the failure state, and red means failure.
   */
  action?: ReactNode;
}

export default function ErrorState({ message, action }: ErrorStateProps) {
  if (action) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: '0 var(--space-4)',
          textAlign: 'center',
        }}
      >
        <p className="field-error" role="alert" style={{ margin: '0', maxWidth: '32ch' }}>
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
