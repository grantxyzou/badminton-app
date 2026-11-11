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
import { clubRunOf, type GuestCap } from './clubRun';
import type { GroupSettings, Player } from './types';

/** A first name, not a full one: the display form carries the host's name too. */
export const GUEST_NAME_MAX = 20;

/**
 * How many guests a member may bring to a session: the club's `run.guests`
 * (lib/clubRun.ts), or the old `guestsAllowed` switch (on = 1) for a club that
 * never set it. Absent = 0.
 */
export function guestsPerMemberOf(settings: Pick<GroupSettings, 'guestsAllowed' | 'run'> | null | undefined): GuestCap {
  return clubRunOf(settings).guests;
}

/** Whether the club lets members bring guests at all. */
export function guestsAllowedOf(settings: Pick<GroupSettings, 'guestsAllowed' | 'run'> | null | undefined): boolean {
  return guestsPerMemberOf(settings) > 0;
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

/**
 * The row's `name`: `Jenny (Josh)`, the way a club's own list writes a guest
 * (docs/plans/six-feathers-guests.md). Rows written before 2026-11-05 carry
 * `Jenny (Josh's guest)`; nothing reads the name to find a guest
 * (`isGuestRow`, `matchesIdentity` key on `guestOf`), so both stand.
 */
export function guestDisplayName(guestName: string, hostName: string): string {
  return `${guestName} (${hostName})`;
}

export function isGuestRow(p: Pick<Player, 'guestOf'>): boolean {
  return typeof p.guestOf === 'string' && p.guestOf.length > 0;
}
