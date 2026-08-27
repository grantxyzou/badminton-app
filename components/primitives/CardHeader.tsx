import type { ReactNode } from 'react';

/**
 * Card header — the canonical icon + title (+ subtitle) (+ trailing badge or
 * action) row that sits at the top of a `.glass-card`. Bakes in the two-tier
 * header spec so the ~11 hand-rolled copies across stats/admin cards stop
 * drifting (see standardization Phase 1a):
 *
 *   - icon: 22px, `var(--accent)` (override via `iconColor`); `--icon-sm` at
 *     weight 600 under `compact`, matching the section label it sits beside
 *   - title: `.bpm-h3`
 *   - subtitle: `--fs-sm` (12) / `--text-muted` / `2px 0 0` / `--lh-snug`
 *   - alignment: `flex-start` + icon `marginTop:1` WHEN a subtitle is present
 *     (so the icon optically aligns to the title's first line); `center`
 *     for a title-only header
 *   - trailing `badge` or `action` (e.g. a re-rate button) is right-aligned
 *     via `space-between`
 *
 * Replaces e.g.:
 *
 *   <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 *     <span className="material-icons" style={{ fontSize: 'var(--fs-stat-lg)' }}>trending_up</span>
 *     <div>
 *       <h3 className="bpm-h3 m-0">{title}</h3>
 *       <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>{sub}</p>
 *     </div>
 *   </div>
 *
 * With:  <CardHeader icon="trending_up" title={title} subtitle={sub} />
 *
 * Note: the Tier-A spec above is the default. Cards that NAME a thing rather
 * than announce one pass `compact` and get the section-label treatment for both
 * title and icon — see that prop. (This comment used to say compact tiles were
 * "intentionally not routed through this primitive"; StringingCard routes
 * through it, which is how the icon-size mismatch got in.)
 */
export interface CardHeaderProps {
  /** Material Symbols glyph name (e.g. `'trending_up'`). Omit for no icon. */
  icon?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned status pill (e.g. "Live"/"Beta"). Mutually exclusive with `action`. */
  badge?: ReactNode;
  /** Right-aligned interactive element (e.g. a re-rate button). */
  action?: ReactNode;
  /** Icon color token. Defaults to the accent. */
  iconColor?: string;
  /**
   * Render the title as a SECTION LABEL rather than a heading — the same
   * `.section-label-muted` worn by LOCATION / WHEN / SIGN UP.
   *
   * For a card that names a thing rather than announces one. Matching the
   * family alone was not enough: sentence-case semibold beside uppercase
   * tracked bold still read as two different kinds of title on one screen.
   * Same class, so they cannot drift apart again.
   */
  compact?: boolean;
}

export default function CardHeader({
  icon,
  title,
  subtitle,
  badge,
  action,
  iconColor,
  compact = false,
}: CardHeaderProps) {
  const trailing = badge ?? action ?? null;
  // Compact means the title IS a section label, and globals.css states the
  // principle for what sits next to one: "an icon inside a section label is
  // PART of the label, so it takes the label's weight and colour". So the
  // compact default is the label's own colour, not the accent.
  const resolvedIconColor = iconColor ?? (compact ? 'var(--text-muted)' : 'var(--accent, #22c55e)');

  const left = (
    <div style={{ display: 'flex', alignItems: subtitle ? 'flex-start' : 'center', gap: 8, minWidth: 0 }}>
      {icon && (
        <span
          className="material-icons"
          aria-hidden="true"
          style={{
            // `compact` turns the title into a section label, so the icon has
            // to become part of that label too — 22px/400 beside an 11px
            // tracked uppercase title is the Tier-A heading icon wearing a
            // section label's clothes, and it read as a size bug on Home next
            // to UnpaidSessionsCard's 16px one.
            //
            // These are the values globals.css already gives
            // `.section-label-muted .material-icons`, and the reason they are
            // repeated here rather than inherited is structural: that rule is a
            // DESCENDANT selector, and this icon is a SIBLING of the <h3>, not
            // inside it. Keep the two in step.
            ...(compact
              ? { fontSize: 'var(--icon-sm)', fontVariationSettings: "'opsz' 24, 'wght' 600, 'FILL' 0, 'GRAD' 0" }
              : { fontSize: 'var(--fs-stat-lg)' }),
            color: resolvedIconColor,
            ...(subtitle ? { marginTop: 1 } : null),
          }}
        >
          {icon}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        {/* A section label is not a heading — this prop's whole point is that
            the card NAMES a thing rather than announces one, so <h3> was
            contradicting it. It also matters structurally: both compact
            consumers wrap this header in a <button> to make the card
            collapsible, and <button> takes phrasing content, which <h3> is
            not. <p> matches the four other `.section-label-muted` sites. */}
        {compact ? (
          <p className="section-label-muted m-0">{title}</p>
        ) : (
          <h3 className="bpm-h3 m-0">{title}</h3>
        )}
        {subtitle && (
          <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '2px 0 0' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  if (!trailing) return left;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
      {left}
      {trailing}
    </div>
  );
}
