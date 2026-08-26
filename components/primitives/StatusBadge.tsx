import type { CSSProperties, ReactNode } from 'react';

/**
 * Status badge — the small uppercase pill that appears in card headers and
 * tiles ("Live" / "Beta" / "Coming soon") and as the skill-phase tag. Replaces
 * the ~6-8 hand-rolled inline pill blocks across the stats cards, which had
 * drifted on font size (9/10/11) and padding (2px 7px / 3px 8px / 3px 10px).
 *
 * One shared shape; pick a variant:
 *   - `accent` (default) — the Live/Beta pill (accent border + text, --fs-2xs)
 *   - `muted`            — the compact "Coming soon" tag (muted border/text, 9px)
 *   - `ai`               — AI provenance marker. Wears the insight card's own
 *                          conic rim (`--ai-rim`) at pill scale, so the badge and
 *                          the surface it marks read as one idea rather than a
 *                          green pill sitting on a rainbow card.
 *   - `phase`            — the larger skill-phase tag; pass `tone="amber"` for
 *                          the "switch" phase, else accent
 *
 * Colors come from tokens (`--accent` / `--accent-amber` / `--inner-card-border`
 * / `--text-muted`); radius from `--radius-pill`. Text is the children.
 */
export type StatusBadgeVariant = 'accent' | 'muted' | 'phase' | 'ai';

export interface StatusBadgeProps {
  children: ReactNode;
  variant?: StatusBadgeVariant;
  /** Only meaningful for `variant="phase"`. */
  tone?: 'accent' | 'amber';
}

const BASE: CSSProperties = {
  display: 'inline-block',
  borderRadius: 'var(--radius-pill)',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

export default function StatusBadge({ children, variant = 'accent', tone = 'accent' }: StatusBadgeProps) {
  let style: CSSProperties;
  if (variant === 'ai') {
    // The ring is a masked ::before on .badge-ai, so no border here — the
    // class sets `border: none` to stop BASE's border painting under it.
    return (
      <span className="badge-ai" style={{ ...BASE, fontSize: 'var(--fs-2xs)', padding: '3px 9px', color: 'var(--text-primary)' }}>
        {children}
      </span>
    );
  }
  if (variant === 'muted') {
    style = { ...BASE, fontSize: 'var(--fs-2xs)', padding: '2px 7px', border: '1px solid var(--inner-card-border)', color: 'var(--text-muted)' };
  } else if (variant === 'phase') {
    const c = tone === 'amber' ? 'var(--accent-amber)' : 'var(--accent)';
    style = { ...BASE, fontSize: 'var(--fs-xs)', padding: '3px 10px', border: `1px solid ${c}`, color: c };
  } else {
    style = { ...BASE, fontSize: 'var(--fs-2xs)', padding: '3px 8px', border: '1px solid var(--accent, #22c55e)', color: 'var(--accent, #22c55e)' };
  }
  return <span style={style}>{children}</span>;
}
