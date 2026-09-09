/**
 * Drill completions — one doc per member per week.
 *
 * Stored in its own `drillCompletions` container (PK `/memberId`) rather than
 * as a field on the member doc. The member doc is the auth record: it carries
 * `pinHash` and `recoveryCode`, and a read-modify-write on every drill tap
 * would race a concurrent PIN change and could clobber it. A separate
 * container also keeps drill history available if it ever becomes interesting,
 * which a single overwritten array would not.
 *
 * `weekKey` is the active session id (`session-YYYY-MM-DD`) — the same value
 * `lib/drills.ts` uses as its rotation seed, so completions and picks rotate
 * together by construction rather than by two clocks agreeing.
 */

import { isoWeekKey } from './kudos';

export interface DrillCompletionDoc {
  /** `${memberId}:${weekKey}` — one doc per member-week. */
  id: string;
  memberId: string;
  weekKey: string;
  done: string[];
  updatedAt: string;
}

export function drillDocId(memberId: string, weekKey: string): string {
  return `${memberId}:${weekKey}`;
}

/**
 * Which week a completion (and the drill rotation) belongs to: the active
 * session id, or the real ISO week when a group has no session yet.
 *
 * ONE owner, used by the write, the read and the rotation seed alike. The
 * first cut had two fallbacks — the write used the ISO week, the read used
 * '' — so a completion in a session-less group was written and never read
 * back.
 */
export function weekKeyFor(activeSessionId: string | null, now: Date = new Date()): string {
  return activeSessionId ?? isoWeekKey(now);
}

/**
 * Read-tolerant accessor. A missing doc, a missing array, or garbage entries
 * all read as "nothing done" rather than throwing — the completion counter is
 * decoration on top of the drills, and must never take the card down with it.
 */
export function readDone(doc: DrillCompletionDoc | null | undefined): string[] {
  if (!doc || !Array.isArray(doc.done)) return [];
  return doc.done.filter((d): d is string => typeof d === 'string' && d.length > 0);
}
