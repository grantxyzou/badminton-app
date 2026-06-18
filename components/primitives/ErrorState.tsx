import type { ReactNode } from 'react';

/**
 * Load-error pill — the canonical "couldn't load" message. Centralizes the
 * `role="alert"` contract and the error styling that was hand-written ~50×
 * across stats/admin cards (the "legible-fail" rule: a failed fetch must NOT
 * render as a confident empty state). One place to restyle the error tone.
 *
 * Replaces:  <p className="text-red-400 text-xs" role="alert">{msg}</p>
 * With:      <ErrorState message={msg} />
 */
export interface ErrorStateProps {
  message: ReactNode;
}

export default function ErrorState({ message }: ErrorStateProps) {
  return (
    <p className="text-red-400 text-xs" role="alert" style={{ margin: 0 }}>
      {message}
    </p>
  );
}
