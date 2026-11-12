/**
 * Shared formatting helpers for dates, times, and ISO assembly.
 *
 * These were duplicated across components/admin/CommandCenter/* and the
 * legacy editors. Centralizing here so timezone behavior + presentation
 * stay consistent and a single tweak (e.g., locale) propagates. Every
 * date/time helper formats in `CLUB_TIME_ZONE`, never the device's zone.
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

/**
 * The zone every session date and time is shown in, whatever the device's.
 *
 * A session at `2026-11-19T19:00:00-08:00` is Thursday 7 PM at the club. A
 * phone set to UTC formatting it in its own zone printed "Fri, Nov 20" and
 * "3:00 AM". Every club is in BC today; a club elsewhere needs a per-group
 * zone (CLAUDE.md, Gotchas, "Session times display in Vancouver time").
 */
export const CLUB_TIME_ZONE = 'America/Vancouver';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bare `YYYY-MM-DD` (a shuttle purchase's date) is a calendar day, not a
 * moment. `new Date()` reads it as UTC midnight, which is the afternoon
 * before in Vancouver, so it is formatted in UTC to keep the day it names.
 */
function zoneFor(iso: string): string {
  return BARE_DATE.test(iso) ? 'UTC' : CLUB_TIME_ZONE;
}

/** Short, locale-aware date — 'May 7'. */
export function fmtShortDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: zoneFor(iso) });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day-of-week + short date — 'Wed, May 7'. */
export function fmtSessionLabel(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: zoneFor(iso) });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day-of-week + month/day/year — 'Wed, May 7, 2026'. */
export function fmtFullDate(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: zoneFor(iso) });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Day-of-week + time — 'Thu, 8:00 PM'. Used for the sign-up deadline display. */
export function fmtDeadline(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: zoneFor(iso) });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Time of day only — '7:00 PM'. Beside `fmtSessionLabel` on the console's session card. */
export function fmtTime(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: zoneFor(iso) });
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

/**
 * Dollars as a person reads a price: `$30` when whole, `$30.50` when not.
 *
 * Never rounded. A `$34.50` restring must not read `$35` on the card and
 * `$34.50` on the bill, which is what a `Math.round` here would do. The
 * stringing surfaces share this one; three older private copies (the balance
 * card, the payments card, a player's profile sheet) say the same thing.
 */
export function fmtMoney(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
