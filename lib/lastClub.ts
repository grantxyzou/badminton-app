/**
 * THE CLUB THIS PHONE WAS LAST SIGNED IN TO — a hint, never a credential.
 *
 * "Ask to be let in" is made by someone who is signed OUT: a forgotten PIN, or
 * a 30-day `member_session` that expired while the app stayed on the home
 * screen. With no cookie there is no group claim, and `resolveGroupId` answers
 * BPM — so a member of another club was looked up on BPM's roster, and a BPM
 * member who happened to share their name received the request. Approval is
 * blind by design, so one tap there would sign the asker in as the wrong
 * person (docs/plans/multi-group.md, "Ask to be let in", Grant 2026-11-04).
 *
 * The phone remembers the club while it IS signed in (`HomeShell`, from
 * `useCurrentGroup`), and the ask carries it. The server looks the name up in
 * that club ONLY. It is safe to trust from a signed-out caller because it
 * grants nothing: it chooses which roster a name is read from, the answer is
 * the same 200 whatever it chooses, and a human in THAT club still has to
 * approve. Choosing another club's id buys a stranger exactly what naming a
 * BPM member always has — a request an admin will see and can decline.
 *
 * Kept across sign-out on purpose: signed out is the state it exists for. The
 * next person to sign in on the phone overwrites it.
 */

const KEY = 'badminton_last_club';

/** Group ids are `randomBytes(8)` hex, the legacy `bpm`, or a seed's slug. */
const SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/** A value that could be a group id. Anything else is not a hint at all. */
export function isClubHint(value: unknown): value is string {
  return typeof value === 'string' && SHAPE.test(value);
}

export function rememberClub(groupId: string): void {
  if (!isClubHint(groupId)) return;
  try {
    localStorage.setItem(KEY, groupId);
  } catch {
    /* private mode or storage blocked: the ask falls back to the cookie's club */
  }
}

export function lastClub(): string | null {
  try {
    const value = localStorage.getItem(KEY);
    return isClubHint(value) ? value : null;
  } catch {
    return null;
  }
}
