import type { ReactNode } from 'react';

/**
 * Empty-state copy — the muted "nothing here yet" line shown when a card
 * loaded successfully but has no data (distinct from <ErrorState>, which is
 * a load failure). Standardizes the recurring inline
 * `{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0 }` text on the
 * `--fs-base` token.
 *
 * Replaces:  <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0 }}>{msg}</p>
 * With:      <EmptyState>{msg}</EmptyState>
 *
 * ## Two shapes, and when each applies
 *
 * **Inline** (no `icon`) — a muted line in the normal flow. Right when the
 * empty state is one detail inside a card that has other content to show.
 *
 * **Standing** (`icon` given) — glyph over centred copy, 20px above and below.
 * Right when emptiness is the WHOLE of what the card is currently saying. A
 * bare sentence left-aligned under a header reads as a caption someone forgot
 * to finish; the same sentence centred under a glyph reads as a deliberate
 * state. Several Stats cards were in the first category and should have been
 * in the second.
 *
 * The icon is decorative — the copy already says everything — so it is
 * `aria-hidden`, per the same rule the rest of the app applies to
 * `.material-icons`.
 */
export interface EmptyStateProps {
  children: ReactNode;
  /**
   * Adding one switches this to the standing layout.
   *
   * A **string** is a Material Symbols ligature name, and must already be in
   * the `icon_names=` subset in `app/layout.tsx` — that list is alphabetically
   * sorted and the whole font request 404s if a name is missing or out of
   * order, which renders every glyph in the app as its literal text.
   *
   * A **node** is for the cases the design system reserves for something other
   * than a Material glyph — chiefly `<ShuttleIcon>`, which DESIGN.md keeps for
   * "anywhere the UI refers to the sport itself". Sized by the caller; 40px
   * matches the `.icon-xl` rung this uses for ligatures.
   */
  icon?: string | ReactNode;
}

export default function EmptyState({ children, icon }: EmptyStateProps) {
  if (!icon) {
    return (
      <p className="fs-base" style={{ color: 'var(--text-muted)', margin: 0 }}>
        {children}
      </p>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-6) var(--space-4)',
        textAlign: 'center',
      }}
    >
      {typeof icon === 'string' ? (
        <span
          className="material-icons icon-xl"
          aria-hidden="true"
          style={{ color: 'var(--text-muted)', lineHeight: 1 }}
        >
          {icon}
        </span>
      ) : (
        <span aria-hidden="true" style={{ lineHeight: 1, display: 'flex' }}>{icon}</span>
      )}
      <p className="fs-base" style={{ color: 'var(--text-muted)', margin: 0, maxWidth: '28ch' }}>
        {children}
      </p>
    </div>
  );
}
