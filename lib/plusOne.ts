/**
 * A plus-one: a member brings one guest to a session (docs/plans/plus-one.md).
 *
 * The guest is a `players` row of their own, so the cap, the cost split, the
 * waitlist and its auto-promote count them with no rule of their own. What
 * makes the row a guest is `guestOf` — the HOST's memberId — and the row has
 * no `memberId`: the guest has no account, and the host pays their share
 * (`matchesIdentity` folds the row into the host's balance; the ledger charges
 * it to the host).
 *
 * The row's `name` is a DISPLAY form that cannot be a roster name, "Alex
 * (Lin's guest)": several reads still tie a row to a person by name (the
 * sign-up duplicate check, the self-cancel lookup, older code after a
 * rollback), and a guest called Lin must never be taken for member Lin.
 */
import type { GroupSettings, Player } from './types';

/** A first name, not a full one: the display form carries the host's name too. */
export const GUEST_NAME_MAX = 20;

/** Whether the club lets members bring a guest. Absent = off. */
export function guestsAllowedOf(settings: Pick<GroupSettings, 'guestsAllowed'> | null | undefined): boolean {
  return settings?.guestsAllowed === true;
}

/** A trimmed guest name with single spaces, or `null` when it is not one. */
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > GUEST_NAME_MAX) return null;
  // Brackets are the display form's own punctuation; a name carrying them
  // could imitate it.
  if (/[()]/.test(name)) return null;
  return name;
}

/** The row's `name`. English, like every name stored on a row. */
export function guestDisplayName(guestName: string, hostName: string): string {
  return `${guestName} (${hostName}'s guest)`;
}

export function isGuestRow(p: Pick<Player, 'guestOf'>): boolean {
  return typeof p.guestOf === 'string' && p.guestOf.length > 0;
}
