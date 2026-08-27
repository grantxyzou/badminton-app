/**
 * What the bench row says on the right-hand side, and what colour it is.
 *
 * Pure, with `today` injected rather than read from the clock, so the same job
 * always produces the same answer in a test and the boundary cases (today vs
 * tomorrow vs one day overdue) can actually be exercised.
 *
 * WHY `readyBy` HAD TO BECOME A DATE
 * ----------------------------------
 * It shipped as free text — whatever the stringer typed, stored raw and
 * rendered straight to the player. Three things were wrong with that, and only
 * the first is cosmetic:
 *
 *   - It could not be translated. A zh-CN member read "Sunday, August 30".
 *   - It could not be compared, so nothing could ever be overdue. The design's
 *     bench sorts and colours by urgency, which is the entire reason a stringer
 *     opens that screen, and free text makes that impossible.
 *   - Two stringers would write it two ways.
 *
 * So it is an ISO `YYYY-MM-DD`, formatted at the edge for whoever is reading.
 */

export type DueTone = 'overdue' | 'soon' | 'ok' | 'done';

export interface DueLabel {
  /** i18n key suffix under `admin.stringing.due`. */
  key: 'pickedUp' | 'readyUnpaid' | 'noDate' | 'overdue' | 'today' | 'tomorrow' | 'onDate';
  /** Whole days overdue — only set for `overdue`. */
  days?: number;
  /** ISO date, for the caller to format — only set for `onDate`. */
  date?: string;
  tone: DueTone;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC for a `YYYY-MM-DD`, or null if it is not one. */
function midnight(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function dueFor(
  job: { readyBy: string | null; status: string; paidAt: string | null },
  todayIso: string,
): DueLabel {
  // A finished job is not due. Checked before the date so a picked-up racket
  // never shows as overdue — the stringer has nothing left to do about it.
  if (job.status === 'picked_up') return { key: 'pickedUp', tone: 'done' };

  // Ready but unpaid is the one state where the outstanding thing is money
  // rather than work, and the design calls it out on its own. It also outranks
  // the date: chasing payment on a racket finished early still matters.
  if (job.status === 'ready' && job.paidAt === null) {
    return { key: 'readyUnpaid', tone: 'ok' };
  }

  const due = midnight(job.readyBy);
  const today = midnight(todayIso);
  // An unparseable or absent date is UNKNOWN, never overdue. Colouring a job
  // red because nobody promised a day would punish the stringer for the app's
  // own missing information.
  if (due === null || today === null) return { key: 'noDate', tone: 'ok' };

  const days = Math.round((due - today) / DAY_MS);
  if (days < 0) return { key: 'overdue', days: -days, tone: 'overdue' };
  if (days === 0) return { key: 'today', tone: 'soon' };
  if (days === 1) return { key: 'tomorrow', tone: 'soon' };
  return { key: 'onDate', date: job.readyBy!, tone: 'ok' };
}

/** Today as `YYYY-MM-DD` in the viewer's own timezone, not UTC. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A `readyBy` value formatted for display, or null if it is not a date.
 *
 * `fmtShortDate` cannot be used directly here: it calls `toLocaleDateString`
 * on whatever it is given, and for an unparseable string that returns the
 * literal text "Invalid Date" rather than throwing — so its own try/catch
 * never fires and the user reads "Invalid Date" instead of what they typed.
 *
 * This matters because `readyBy` USED to be a free-text field. Rows written
 * before it became a date still hold "Sunday" or "next week", and the honest
 * thing is to show those back unchanged rather than to relabel them as broken.
 */
export function formatReadyBy(readyBy: string | null | undefined): string | null {
  const ms = midnight(readyBy ?? null);
  if (ms === null) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
