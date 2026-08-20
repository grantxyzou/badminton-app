'use client';

import { useTranslations } from 'next-intl';
import type { Dimension } from '@/lib/assessment';

/**
 * Three dimension bars — Technical / Physical / Mental — with optional club
 * median ticks. Replaces the 14-axis recharts radar.
 *
 * Why bars beat the radar here:
 *   - The radar needed `recharts`, which was the single largest thing in the
 *     Stats bundle and had to be `dynamic(..., { ssr: false })` because it
 *     touches `window`.
 *   - recharts sets stroke and fill as SVG ATTRIBUTES, where `var()` cannot
 *     resolve, so the colours had to be hardcoded hex and re-read at runtime
 *     through a `MutationObserver` on `data-theme` just to survive a theme
 *     toggle. All of that goes away: these are CSS gradients on divs, so the
 *     tokens simply work, in both themes, with no JS.
 *   - A 14-axis radar of self-rated 1-5 values is close to unreadable at phone
 *     width; three bars answer "where am I strong" at a glance.
 *
 * The median ticks and their legend render ONLY when the club comparison is
 * revealed AND the cohort is large enough. There is no ghost tick and no
 * apology line explaining an absent comparison — an absent comparison should
 * look like bars, not like something broken.
 */

const ORDER: Dimension[] = ['technical', 'physical', 'mental'];

/**
 * Fill gradients, one per dimension. Every colour is a token: `components/stats`
 * lints bare hex at ERROR level, and more importantly a literal would be the
 * resolved DARK value and would not follow the light theme.
 */
const FILL: Record<Dimension, string> = {
  technical:
    'linear-gradient(90deg, var(--sev-low-text), color-mix(in srgb, var(--sev-low-text) 60%, black))',
  physical: 'linear-gradient(90deg, var(--accent), var(--accent-dark))',
  mental:
    'linear-gradient(90deg, var(--accent-amber), color-mix(in srgb, var(--sev-warn) 70%, black))',
};

/** Theme-aware tick colour — a dark tick in light mode, a light one in dark. */
const TICK = 'color-mix(in srgb, var(--text-primary) 50%, transparent)';

const MAX = 5;

const pct = (v: number) => `${Math.max(0, Math.min(100, (v / MAX) * 100))}%`;

export interface DimensionBarsProps {
  scores: Partial<Record<Dimension, number | null>>;
  /** Previous snapshot, for the per-row delta. Omit on a first check-in. */
  prevScores?: Partial<Record<Dimension, number | null>>;
  /** Club medians. Ticks render only when a dimension has one AND `showTicks`. */
  medians?: Partial<Record<Dimension, number | null>> | null;
  /** False when comparison is off, unanswered, or the cohort is too small. */
  showTicks?: boolean;
}

export default function DimensionBars({
  scores,
  prevScores,
  medians,
  showTicks = false,
}: DimensionBarsProps) {
  const t = useTranslations('stats.assess');

  const anyTick =
    showTicks && ORDER.some((d) => typeof medians?.[d] === 'number');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {ORDER.map((dim) => {
        const value = scores[dim];
        const prev = prevScores?.[dim];
        const median = showTicks ? medians?.[dim] : null;
        const delta =
          typeof value === 'number' && typeof prev === 'number' ? value - prev : null;

        return (
          <div key={dim}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-2)',
                gap: 'var(--space-2)',
              }}
            >
              <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>
                {t(`dim.${dim}`)}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-md)',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  {typeof value === 'number' ? value.toFixed(1) : '—'}
                </span>
                <Delta value={delta} />
              </span>
            </div>

            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 'var(--radius-pill)',
                background: 'var(--inner-card-bg)',
              }}
            >
              {typeof value === 'number' && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: pct(value),
                    background: FILL[dim],
                    borderRadius: 'var(--radius-pill)',
                  }}
                />
              )}
              {typeof median === 'number' && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: pct(median),
                    top: -3,
                    height: 14,
                    width: 2,
                    background: TICK,
                  }}
                />
              )}
            </div>
          </div>
        );
      })}

      {anyTick && (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 2, height: 11, background: TICK, display: 'inline-block' }}
          />
          {t('medianLegend')}
        </p>
      )}
    </div>
  );
}

/** Hidden below 0.05 — a delta the member cannot perceive reads as a change
 *  that did not happen. Mirrors the same rule in the overview strip. */
function Delta({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.05) return null;
  const up = value > 0;
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-xs)',
        fontWeight: 600,
        color: up ? 'var(--accent)' : 'var(--accent-amber)',
      }}
    >
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(1)}
    </span>
  );
}
