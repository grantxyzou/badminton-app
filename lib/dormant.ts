/**
 * The one reading of "this member has gone quiet".
 *
 * The admin Roster tile and Profile's admin row each counted it by hand,
 * with the same two tests: never played, or not seen in 60 days. Neither
 * knew how long the person had BEEN a member, so a brand-new organiser
 * opened their new group to "1 need you" — themselves — and every fresh
 * invite counted as dormant until their first session (create-a-group walk,
 * 2026-10-09). Grant chose a grace period equal to the window itself: nobody
 * is dormant until they have been a member for {@link DORMANT_DAYS} days.
 *
 * The join date is the GROUP's (`joinedAt` on the membership, sent to admins
 * by `GET /api/members`) when there is one, so an old account joining a new
 * group gets the grace there too; it falls back to the account's own
 * `createdAt`. With neither, there is no grace — the rule as it was.
 */
export const DORMANT_DAYS = 60;

export interface DormantInput {
  active?: boolean;
  sessionCount?: number;
  lastSeen?: string;
  joinedAt?: string;
  createdAt?: string;
}

const DAY_MS = 86_400_000;

/** True while the member joined fewer than {@link DORMANT_DAYS} days ago. */
export function isNewMember(m: DormantInput, now: number = Date.now()): boolean {
  const joined = new Date(m.joinedAt ?? m.createdAt ?? '').getTime();
  return Number.isFinite(joined) && joined > now - DORMANT_DAYS * DAY_MS;
}

export function isDormant(m: DormantInput, now: number = Date.now()): boolean {
  if (m.active === false) return false;
  if (isNewMember(m, now)) return false;
  if (!m.sessionCount) return true;
  if (m.lastSeen) {
    const seen = new Date(m.lastSeen).getTime();
    if (Number.isFinite(seen) && seen < now - DORMANT_DAYS * DAY_MS) return true;
  }
  return false;
}
