'use client';

import type { ReactNode, CSSProperties } from 'react';

export type StatTone = 'accent' | 'blue' | 'amber' | 'neutral';

/**
 * Gradient stat card — the "Insights" visual language (big number + label on a
 * rich gradient, optional inline chart/icon). Brand-harmonious palette built
 * entirely from theme tokens + color-mix (no bare hex → passes the stats token
 * guardrail); each stop is deepened toward black so white text stays legible.
 */
const GRADIENTS: Record<StatTone, string> = {
  accent: 'linear-gradient(140deg, color-mix(in srgb, var(--accent) 82%, black), color-mix(in srgb, var(--accent-dark) 92%, black))',
  blue: 'linear-gradient(140deg, color-mix(in srgb, var(--sev-low-text) 72%, black), color-mix(in srgb, var(--sev-low-text) 36%, black))',
  amber: 'linear-gradient(140deg, color-mix(in srgb, var(--color-amber) 88%, black), color-mix(in srgb, var(--color-red) 78%, black))',
  neutral: 'linear-gradient(140deg, color-mix(in srgb, var(--sev-low-text) 24%, black), color-mix(in srgb, var(--sev-low-text) 8%, black))',
};

const TEXT_SHADOW = '0 1px 2px color-mix(in srgb, black 24%, transparent)';
const ON = 'white';
const ON_SOFT = 'color-mix(in srgb, white 86%, transparent)';
const ON_DIM = 'color-mix(in srgb, white 74%, transparent)';

interface StatCardProps {
  tone?: StatTone;
  /** Uppercase eyebrow at the top. */
  label: string;
  /** The headline value (big mono number). */
  value?: ReactNode;
  /** Small unit beside the value (e.g. "of 5", "min"). */
  unit?: string;
  /** Footer line under the value. */
  caption?: ReactNode;
  /** Material Symbols glyph — a large low-opacity watermark on hero, or a small
   *  inline glyph beside the label on a tile. Must be in the layout.tsx subset. */
  icon?: string;
  /** Right-side slot (e.g. a mini chart). Lays the card out in two columns. */
  aside?: ReactNode;
  /** Extra content between the value and caption (e.g. a name headline). */
  children?: ReactNode;
  size?: 'hero' | 'tile';
  /** When set the whole card is a button (tap-through to detail). */
  onClick?: () => void;
  ariaLabel?: string;
}

export default function StatCard({
  tone = 'accent',
  label,
  value,
  unit,
  caption,
  icon,
  aside,
  children,
  size = 'hero',
  onClick,
  ariaLabel,
}: StatCardProps) {
  const hero = size === 'hero';
  const valueSize = hero ? 'clamp(40px, 13vw, 56px)' : 'var(--fs-stat-lg)';

  const base: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 'var(--radius-xl)',
    background: GRADIENTS[tone],
    boxShadow: 'var(--glass-shadow)',
    padding: hero ? 'var(--space-6)' : 'var(--space-5)',
  };

  const inner = (
    <>
      {icon && hero && (
        <span
          className="material-icons"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -8,
            right: -6,
            lineHeight: 1,
            fontSize: 'clamp(84px, 30vw, 128px)',
            color: 'color-mix(in srgb, white 14%, transparent)',
            pointerEvents: 'none',
          }}
        >
          {icon}
        </span>
      )}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: aside ? 'row' : 'column',
          alignItems: aside ? 'center' : 'flex-start',
          gap: aside ? 'var(--space-4)' : 0,
        }}
      >
        <div style={{ minWidth: 0, flex: aside ? '0 0 auto' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: hero ? 'var(--space-3)' : 'var(--space-2)' }}>
            {icon && !hero && (
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: ON, textShadow: TEXT_SHADOW }}>
                {icon}
              </span>
            )}
            <span className="fs-2xs" style={{ color: ON_SOFT, textShadow: TEXT_SHADOW, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
              {label}
            </span>
          </div>
          {value !== undefined && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: valueSize, fontWeight: 700, color: ON, lineHeight: 1, textShadow: TEXT_SHADOW }}>
                {value}
              </span>
              {unit && (
                <span className={hero ? 'fs-lg' : 'fs-sm'} style={{ color: ON_SOFT, fontWeight: 600, textShadow: TEXT_SHADOW }}>
                  {unit}
                </span>
              )}
            </div>
          )}
          {children}
          {caption && (
            <p className="fs-sm" style={{ margin: 0, marginTop: 'var(--space-3)', color: ON_DIM, textShadow: TEXT_SHADOW }}>
              {caption}
            </p>
          )}
        </div>
        {aside && <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{aside}</div>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} style={{ ...base, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}>
        {inner}
      </button>
    );
  }
  return (
    <div style={base} aria-label={ariaLabel}>
      {inner}
    </div>
  );
}
