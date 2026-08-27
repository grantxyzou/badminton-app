import type { ReactNode } from 'react';

/**
 * Card header — the canonical icon + title (+ subtitle) (+ trailing badge or
 * action) row that sits at the top of a `.glass-card`. Bakes in the two-tier
 * header spec so the ~11 hand-rolled copies across stats/admin cards stop
 * drifting (see standardization Phase 1a):
 *
 *   - icon: 22px, `var(--accent)` (override via `iconColor`)
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
 * Note: this is for full-width "live" cards (Tier A). The compact coming-soon
 * tiles use a smaller header (icon 20 / badge 9) and are intentionally not
 * routed through this primitive.
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
   * Render the title as a card ROW title rather than a heading — display
   * family at body size, `.bpm-card-title`.
   *
   * For a card that names a thing rather than announces one. Home's account
   * group uses it so "Your balance" and "Stringing service" agree with each
   * other and with the section labels above them; `.bpm-h3` is a size up and
   * had the two cards in one group disagreeing about how loud they were.
   */
  compact?: boolean;
}

export default function CardHeader({
  icon,
  title,
  subtitle,
  badge,
  action,
  iconColor = 'var(--accent, #22c55e)',
  compact = false,
}: CardHeaderProps) {
  const trailing = badge ?? action ?? null;

  const left = (
    <div style={{ display: 'flex', alignItems: subtitle ? 'flex-start' : 'center', gap: 8, minWidth: 0 }}>
      {icon && (
        <span
          className="material-icons"
          aria-hidden="true"
          style={{ fontSize: 'var(--fs-stat-lg)', color: iconColor, ...(subtitle ? { marginTop: 1 } : null) }}
        >
          {icon}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <h3 className={`${compact ? 'bpm-card-title' : 'bpm-h3'} m-0`}>{title}</h3>
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
