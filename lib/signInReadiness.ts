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
 */
import { rosterMembers } from '@/lib/roster';
import type { Member } from '@/lib/types';

export interface SignInReadiness {
  /** Active members on the roster. */
  total: number;
  /** Of those, how many have at least one way to sign in. */
  ready: number;
  /** Everyone who has none, by roster name, alphabetical. Names only. */
  cannotSignIn: string[];
}

/** A PIN, a password, or a linked Google/Apple account. */
export function hasSignInMethod(member: Pick<Member, 'pinHash' | 'passwordHash' | 'linkedProviders'>): boolean {
  if (typeof member.pinHash === 'string' && member.pinHash.length > 0) return true;
  if (typeof member.passwordHash === 'string' && member.passwordHash.length > 0) return true;
  return Array.isArray(member.linkedProviders) && member.linkedProviders.length > 0;
}

export async function readSignInReadiness(groupId: string): Promise<SignInReadiness> {
  const roster = await rosterMembers(groupId);
  const cannotSignIn = roster
    .filter(({ member }) => !hasSignInMethod(member))
    .map(({ member }) => member.name)
    .sort((a, b) => a.localeCompare(b));
  return { total: roster.length, ready: roster.length - cannotSignIn.length, cannotSignIn };
}
