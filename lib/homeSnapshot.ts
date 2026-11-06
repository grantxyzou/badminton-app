import type { Announcement, Player, Session } from './types';

/**
 * Last time's week, shown the moment Home opens (docs/plans/startup-speed.md;
 * Grant, 2026-11-05: slow "waiting on loading placeholder").
 *
 * Home's week — the session, who is in, the announcement — is what a member
 * opens the app to read, and it waited on five reads before anything showed.
 * After every week that loads, Home keeps a copy on this phone; the next open
 * draws the copy at once, marked as updating with its buttons held, and the
 * real answer replaces it a moment later. A refresh that FAILS replaces the
 * copy with the usual error: an old week never stands in for a failure.
 *
 * Never money: the balance and what is owed always wait for the server
 * (those cards are not in the copy). Keyed by the member AND the club, so a
 * club switch never shows another club's week; sign-out forgets it
 * (`clearDeviceTraces`). Best-effort: storage may be off or full.
 */
export const HOME_SNAPSHOT_KEY = 'bpm_home_snapshot';
/** Older than this, the copy is more likely to mislead than to help. */
export const HOME_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface HomeSnapshot {
  v: 1;
  /** `${groupId}|${memberName}`. */
  key: string;
  at: number;
  session: Session;
  players: Player[];
  announcement: Announcement | null;
}

export function homeSnapshotKey(groupId: string | null | undefined, memberName: string | null | undefined): string | null {
  return memberName ? `${groupId ?? 'bpm'}|${memberName}` : null;
}

export function saveHomeSnapshot(key: string | null, week: Pick<HomeSnapshot, 'session' | 'players' | 'announcement'>, now = Date.now()): void {
  if (!key) return;
  const snap: HomeSnapshot = { v: 1, key, at: now, ...week };
  try { localStorage.setItem(HOME_SNAPSHOT_KEY, JSON.stringify(snap)); } catch { /* storage off or full */ }
}

export function readHomeSnapshot(key: string | null, now = Date.now()): HomeSnapshot | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(HOME_SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<HomeSnapshot>;
    if (s?.v !== 1 || s.key !== key || typeof s.at !== 'number') return null;
    if (now - s.at < 0 || now - s.at > HOME_SNAPSHOT_MAX_AGE_MS) return null;
    if (!s.session || typeof s.session !== 'object' || !Array.isArray(s.players)) return null;
    return s as HomeSnapshot;
  } catch {
    return null;
  }
}

export function forgetHomeSnapshot(): void {
  try { localStorage.removeItem(HOME_SNAPSHOT_KEY); } catch { /* storage off */ }
}
