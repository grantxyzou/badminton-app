/**
 * How the admin Metrics page writes a number (docs/plans/usage-metrics.md).
 *
 * Every helper takes `null` and answers the dash, never "0": a null metric is
 * one there is nothing to measure yet, and the page must not read it as a
 * result. English-only, like the rest of the admin surfaces.
 */

export const NONE = '—';

/** 0.4567 → "46%". */
export function pct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v * 100)}%` : NONE;
}

/** Minutes → "under a minute" / "12 min" / "3 h 10 min" / "2 d 4 h". */
export function duration(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) return NONE;
  const m = Math.round(minutes);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / (24 * 60));
  const h = Math.round((m % (24 * 60)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Days as a bare number for a tile labelled in days: 0.04 → "0", 2.54 → "2.5". */
export function dayCount(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return NONE;
  return String(Math.round(v * 10) / 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-02" → "Oct 2". Parsed as a calendar date, so no timezone shift. */
export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${MONTHS[m - 1]} ${d}`;
}

/** "2026-07" → "Jul 2026". */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}
