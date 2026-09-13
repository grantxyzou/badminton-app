/**
 * WHO WOULD BE LOCKED OUT IF MEMBERS-ONLY WERE ON TODAY?
 *
 * docs/plans/members-only.md. With `NEXT_PUBLIC_FLAG_MEMBERS_ONLY` on, a
 * visitor must sign in to see anything, and a session sign-up needs an
 * account. Many regulars have only ever typed their name: no PIN, no password,
 * no Google or Apple. The day the flag flips they reach the welcome screen with
 * no way past it except asking an admin.
 *
 * Grant's decision was "warn first, then request access", and the flip waits
 * until this list is short. So this is the measurement the flip is gated on,
 * and the list an admin works through before it.
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
