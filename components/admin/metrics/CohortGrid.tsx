'use client';

import type { CohortRow } from '@/lib/metricsMath';
import { monthLabel, pct } from '@/lib/metricsFormat';

/**
 * Monthly retention: one row per cohort (the month of each person's first
 * session), one column per month after it. A cell is tinted by its share, so
 * the grid reads at a glance; a month that is not over yet is blank, because
 * a part-month would always look like a drop.
 */
export default function CohortGrid({ rows }: { rows: CohortRow[] }) {
  const cell = {
    padding: 'var(--space-2)',
    textAlign: 'center' as const,
    fontSize: 'var(--fs-sm)',
    fontFamily: 'var(--font-mono)',
  };
  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 'var(--space-05)' }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-2xs)' }}>
          <th scope="col" style={{ ...cell, fontSize: 'var(--fs-2xs)', textAlign: 'left', fontWeight: 600 }}>First played</th>
          <th scope="col" style={{ ...cell, fontSize: 'var(--fs-2xs)', fontWeight: 600 }}>People</th>
          {[1, 2, 3].map((k) => (
            <th key={k} scope="col" style={{ ...cell, fontSize: 'var(--fs-2xs)', fontWeight: 600 }}>
              +{k} mo
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.cohort}>
            <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'inherit' }}>
              {monthLabel(r.cohort)}
            </th>
            <td style={{ ...cell, color: 'var(--text-secondary)' }}>{r.size}</td>
            {r.returned.map((v, i) => (
              <td
                key={i}
                style={{
                  ...cell,
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                  background:
                    v === null
                      ? 'transparent'
                      : `color-mix(in srgb, var(--accent) ${Math.round(8 + v * 50)}%, transparent)`,
                }}
              >
                {v === null ? '' : pct(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
