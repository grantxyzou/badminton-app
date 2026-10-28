'use client';

/**
 * A string's ratings as meters, two to a row (Stringing canvas, 2026-10-28):
 * an uppercase label, an 8px pill track, the score in the data face. One
 * component for both places they appear — the map's selected card and a
 * string's page — so the two cannot draw a 9 differently.
 *
 * `onBand` is the string page's hero, which sits on the string type's own
 * colour: the track darkens the band and the fill is ink. Elsewhere the track
 * is the inner-card tint and the fill is accent.
 */
export interface MeterRow {
  key: string;
  label: string;
  /** 0–10. */
  value: number;
}

export function ratingSourceKey(source: unknown): 'brand' | 'community' | null {
  if (source === 'Brand published') return 'brand';
  if (source === 'Consensus estimate') return 'community';
  return null;
}

export default function RatingMeters({ rows, onBand = false }: { rows: MeterRow[]; onBand?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4) var(--space-5)' }}>
      {rows.map((r) => {
        const pct = Math.max(0, Math.min(10, r.value)) * 10;
        return (
          <div key={r.key}>
            <span
              className="section-label"
              style={{ display: 'block', marginBottom: 'var(--space-1)', color: onBand ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              {r.label}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div
                aria-hidden="true"
                style={{
                  position: 'relative',
                  flex: 1,
                  height: 'var(--space-3)',
                  borderRadius: 'var(--radius-pill)',
                  background: onBand ? 'color-mix(in srgb, var(--page-bg) 35%, transparent)' : 'var(--inner-card-bg)',
                  boxShadow: onBand ? undefined : 'inset 0 0 0 1px var(--inner-card-border)',
                }}
              >
                <div
                  className="bpm-meter-fill"
                  style={{ width: `${pct}%`, background: onBand ? 'var(--text-primary)' : 'var(--accent)' }}
                />
              </div>
              <span className="fs-md" style={{ minWidth: 'var(--space-5)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)' }}>
                {r.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
