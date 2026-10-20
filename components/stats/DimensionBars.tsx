'use client';

import { useTranslations } from 'next-intl';
import type { Dimension } from '@/lib/assessment';

/**
 * Three dimension bars — Technical / Physical / Mental — for "Your skills".
 * Replaces the 14-axis recharts radar.
 *
 * Why bars beat the radar here:
 *   - The radar needed `recharts`, which was the single largest thing in the
 *     Stats bundle and had to be `dynamic(..., { ssr: false })` because it
 *     touches `window`.
 *   - recharts sets stroke and fill as SVG ATTRIBUTES, where `var()` cannot
 *     resolve, so the colours had to be hardcoded hex and re-read at runtime
 *     through a `MutationObserver` on `data-theme` just to survive a theme
 *     toggle. These are CSS on divs, so the tokens simply work, in both themes.
 *   - A 14-axis radar of self-rated 1-5 values is close to unreadable at phone
 *     width; three bars answer "where am I strong" at a glance.
 *
 * YOU AGAINST YOURSELF ONLY (Stats canvas, 2026-10-20). The club median ticks
 * that used to sit on these bars moved to "Where you sit" (`SideSpread`), the
 * one card that compares you with the club — and the one that is
 * consent-gated, so every club figure now lives behind the same answer. Each
 * row is a label, then the bar with its score and the change since the last
 * check-in on the same line.
 */

const ORDER: Dimension[] = ['technical', 'physical', 'mental'];

/**
 * Fills, one per dimension — theme tokens (`--dim-fill-*` in app/globals.css).
 * A literal here would be one value for both themes; light mode wants flatter,
 * quieter fills than dark.
 */
export const DIM_FILL: Record<Dimension, string> = {
  technical: 'var(--dim-fill-technical)',
  physical: 'var(--dim-fill-physical)',
  mental: 'var(--dim-fill-mental)',
};

const MAX = 5;

const pct = (v: number) => `${Math.max(0, Math.min(100, (v / MAX) * 100))}%`;

export interface DimensionBarsProps {
  scores: Partial<Record<Dimension, number | null>>;
  /** Previous snapshot, for the per-row delta. Omit on a first check-in. */
  prevScores?: Partial<Record<Dimension, number | null>>;
}

export default function DimensionBars({ scores, prevScores }: DimensionBarsProps) {
  const t = useTranslations('stats.assess');
  return (
    <div className="dim-rows">
      {ORDER.map((dim) => {
        const value = scores[dim];
        const prev = prevScores?.[dim];
        const delta = typeof value === 'number' && typeof prev === 'number' ? value - prev : null;
        return (
          <div key={dim}>
            <span className="dim-row-label">{t(`dim.${dim}`)}</span>
            <div className="dim-row-line">
              <div className="dim-track">
                {typeof value === 'number' && (
                  <span
                    className="dim-fill"
                    style={{
                      width: pct(value),
                      background: DIM_FILL[dim],
                      // Recipe 5 (Fill): a new check-in moves the bar rather than
                      // redrawing it. A transition runs on CHANGE only, so first
                      // paint still lands at full width on every register switch.
                      transition: 'width var(--duration-slow) var(--ease-out-quart)',
                    }}
                  />
                )}
              </div>
              <span className="dim-row-score">{typeof value === 'number' ? value.toFixed(1) : '—'}</span>
              <span className="dim-row-delta"><Delta value={delta} /></span>
            </div>
          </div>
        );
      })}
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
