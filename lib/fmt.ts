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

/** Day-of-week + time — 'Thu, 8:00 PM'. Used for the sign-up deadline display. */
export function fmtDeadline(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Time of day only — '7:00 PM'. Beside `fmtSessionLabel` on the console's session card. */
export function fmtTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso.slice(11, 16);
  }
}

/**
 * A money figure for a stat TILE: three tiles side by side on a 390px phone
 * leave each number 75px at `--fs-stat` (20px Space Grotesk), measured
 * 2026-10-27. Cents do not fit past $9.99: "$999.99" is 77px, "($205.00)" 92.
 *
 * Grant's ladder (2026-10-27): $9.99 · $480 · $3.4K · $99K · $1.2M, and a
 * negative in accounting brackets, ($205). Takes CENTS, as the ledger does.
 * Rows and receipts keep the exact figure; this is for tiles only.
 */
export function fmtMoneyTile(cents: number): string {
  const dollars = Math.abs(cents) / 100;
  const tenth = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  // 999.5, 9,950 and 999,500 are where a rounded figure would roll into the
  // next rung, so it takes that rung's form ($1K, never $1000 or $10.0K).
  const s =
    dollars < 10 ? `$${dollars.toFixed(2)}`
    : dollars < 999.5 ? `$${Math.round(dollars)}`
    : dollars < 9_950 ? `$${tenth(dollars / 1_000)}K`
    : dollars < 999_500 ? `$${Math.round(dollars / 1_000)}K`
    : `$${tenth(dollars / 1_000_000)}M`;
  return cents < 0 ? `(${s})` : s;
}
