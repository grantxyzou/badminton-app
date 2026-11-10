/**
 * WHO HAS NO WAY TO SIGN IN?
 *
 * docs/plans/members-only.md. Members only is permanent (its flag retired
 * 2026-10-17): a visitor must sign in to see anything, and a session sign-up
 * needs an account. Some regulars have only ever typed their name: no PIN, no
 * password, no Google or Apple, so they reach the welcome screen with no way
 * past it except asking an admin.
 *
 * Before the flip this was the measurement it was gated on ("warn first, then
 * request access", Grant). Now it is the list an admin works through so nobody
 * is left relying on an admin to get back in.
 *
 * A member with a live `member_session` cookie but no credential is still
 * counted: the cookie expires in 30 days, and then they are locked out too.
 *
 * WHO HAS ONLY A PIN? (docs/plans/pin-retirement.md, step 1.) A PIN is the one
 * way in a person cannot recover by themselves: no email on file, so a
 * forgotten PIN means asking for a recovery code. `pinOnly` is the list the
 * plan moves onto Apple, Google or email, and the count its review reads.
 * Organisers and admins come first, because a rank-holder on a PIN is the one
 * a recovery code could take over.
 */
import { rosterMembers, type RosterEntry } from '@/lib/roster';
import type { Member } from '@/lib/types';

export interface SignInReadiness {
  /** Active members on the roster. */
  total: number;
  /** Of those, how many have at least one way to sign in. */
  ready: number;
  /** Everyone who has none, by roster name, alphabetical. Names only. */
  cannotSignIn: string[];
  /**
   * Everyone whose ONLY way in is a PIN: organisers first, then admins, then
   * members, each group alphabetical. `rank` is set for a rank-holder only.
   */
  pinOnly: PinOnlyEntry[];
}

export interface PinOnlyEntry {
  name: string;
  rank?: 'organiser' | 'admin';
}

/** A PIN, a password, or a linked Google/Apple account. */
export function hasSignInMethod(member: Pick<Member, 'pinHash' | 'passwordHash' | 'linkedProviders'>): boolean {
  if (typeof member.pinHash === 'string' && member.pinHash.length > 0) return true;
  if (typeof member.passwordHash === 'string' && member.passwordHash.length > 0) return true;
  return Array.isArray(member.linkedProviders) && member.linkedProviders.length > 0;
}

/** A PIN, and nothing they could recover by themselves: no password, no Google or Apple. */
export function isPinOnly(member: Pick<Member, 'pinHash' | 'passwordHash' | 'linkedProviders'>): boolean {
  if (!(typeof member.pinHash === 'string' && member.pinHash.length > 0)) return false;
  if (typeof member.passwordHash === 'string' && member.passwordHash.length > 0) return false;
  return !(Array.isArray(member.linkedProviders) && member.linkedProviders.length > 0);
}

/** The rank in THIS club: the membership's role with groups on (the roster's
 *  overlay collapses an organiser to `admin` on the member copy, so only the
 *  membership still says `owner`), `Member.role` with them off. */
function rankOf(entry: RosterEntry): PinOnlyEntry['rank'] {
  const role = entry.membership?.role ?? entry.member.role;
  if (role === 'owner') return 'organiser';
  if (role === 'admin') return 'admin';
  return undefined;
}

const RANK_ORDER = { organiser: 0, admin: 1, none: 2 } as const;

export async function readSignInReadiness(groupId: string): Promise<SignInReadiness> {
  const roster = await rosterMembers(groupId);
  const cannotSignIn = roster
    .filter(({ member }) => !hasSignInMethod(member))
    .map(({ member }) => member.name)
    .sort((a, b) => a.localeCompare(b));
  const pinOnly = roster
    .filter(({ member }) => isPinOnly(member))
    .map((entry): PinOnlyEntry => {
      const rank = rankOf(entry);
      return rank ? { name: entry.member.name, rank } : { name: entry.member.name };
    })
    .sort((a, b) => RANK_ORDER[a.rank ?? 'none'] - RANK_ORDER[b.rank ?? 'none'] || a.name.localeCompare(b.name));
  return { total: roster.length, ready: roster.length - cannotSignIn.length, cannotSignIn, pinOnly };
}
