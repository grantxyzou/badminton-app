import type { ReactNode } from 'react';

/**
 * Empty-state copy — the muted "nothing here yet" line shown when a card
 * loaded successfully but has no data (distinct from <ErrorState>, which is
 * a load failure). Standardizes the recurring inline
 * `{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }` text on the
 * `--fs-base` token.
 *
 * Replaces:  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{msg}</p>
 * With:      <EmptyState>{msg}</EmptyState>
 */
export interface EmptyStateProps {
  children: ReactNode;
}

export default function EmptyState({ children }: EmptyStateProps) {
  return (
    <p className="fs-base" style={{ color: 'var(--text-muted)', margin: 0 }}>
      {children}
    </p>
  );
}
