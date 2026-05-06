/**
 * Shared formatting helpers for dates, times, and ISO assembly.
 *
 * These were duplicated across components/admin/CommandCenter/* and the
 * legacy editors. Centralizing here so timezone behavior + presentation
 * stay consistent and a single tweak (e.g., locale) propagates.
 */

/**
 * Compose a local-timezone ISO 8601 datetime from separate date + time
 * inputs. Returns an empty string if either input is missing. The output
 * shape is `YYYY-MM-DDTHH:MM:00±HH:MM` and is what Cosmos stores.
 */
export function withLocalTz(date: string, time: string): string {
  if (!date || !time) return '';
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

/** Short, locale-aware date — 'May 7'. */
export function fmtShortDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day-of-week + short date — 'Wed, May 7'. */
export function fmtSessionLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day-of-week + month/day/year — 'Wed, May 7, 2026'. */
export function fmtFullDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
