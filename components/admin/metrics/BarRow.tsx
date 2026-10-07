'use client';

import { pct } from '@/lib/metricsFormat';

/**
 * One labelled share as a bar: the DimensionBars track and fill, without its
 * translations (the admin surfaces are English-only). `value` is 0–1; null
 * draws an empty track and a dash, never a zero-width "0%".
 */
export default function BarRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  /** Right-hand text; defaults to the percentage. */
  detail?: string;
}) {
  const width = typeof value === 'number' ? `${Math.max(0, Math.min(1, value)) * 100}%` : '0%';
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{label}</span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
          {detail ?? pct(value)}
        </span>
      </div>
      <div
        role="presentation"
        style={{
          position: 'relative',
          height: 8,
          borderRadius: 'var(--radius-pill)',
          background: 'var(--inner-card-bg)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width,
            background: 'var(--accent)',
            borderRadius: 'var(--radius-pill)',
            transition: 'width var(--duration-slow) var(--ease-out-quart)',
          }}
        />
      </div>
    </div>
  );
}
