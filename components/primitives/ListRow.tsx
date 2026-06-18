import type { CSSProperties, ReactNode } from 'react';

/**
 * List row — the shared structural layout for the many list-item rows across
 * the app (skill rows, kudos rows, partner rows, etc.): an optional leading
 * slot + title (+ subtitle) on the left, optional trailing slot on the right,
 * justified. Renders as a `cc-mini-card` <button> when `onClick` is given,
 * else a plain <div>.
 *
 * Deliberately STRUCTURAL, not opinionated about typography: the rows it
 * replaces have legitimately different text styling (a score readout vs a
 * partner name vs a kudos tag), so `title`/`subtitle`/`trailing` take nodes
 * and the caller styles the text. This consolidates the repeated flex +
 * cc-mini-card + gap boilerplate without flattening intentional differences
 * (the reason a single fully-styled row primitive was the wrong call). Spacing
 * uses the --space-* scale.
 *
 *   <ListRow
 *     onClick={() => onPick(key)}
 *     title={<span style={{ fontSize: 'var(--fs-sm)' }}>{label}</span>}
 *     trailing={<Score value={v} />}
 *   />
 */
export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  /** When set, the row renders as a tappable cc-mini-card button. */
  onClick?: () => void;
  ariaLabel?: string;
}

const LAYOUT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  width: '100%',
  textAlign: 'left',
};

export default function ListRow({ leading, title, subtitle, trailing, onClick, ariaLabel }: ListRowProps) {
  const lead = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, flex: 1 }}>
      {leading}
      {subtitle != null ? (
        <div style={{ minWidth: 0 }}>
          <div>{title}</div>
          <div className="fs-sm" style={{ color: 'var(--text-muted)' }}>{subtitle}</div>
        </div>
      ) : (
        title
      )}
    </div>
  );

  const body = (
    <>
      {lead}
      {trailing}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="cc-mini-card"
        style={{ ...LAYOUT, padding: 12, borderRadius: 'var(--radius-lg)', cursor: 'pointer' }}
      >
        {body}
      </button>
    );
  }

  return <div style={LAYOUT}>{body}</div>;
}
