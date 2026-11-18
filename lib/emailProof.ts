import { isFlagOn } from './flags';
import { listMembershipsForMember, signOutEverywhereIn } from './groups';

/**
 * PROOF WINS (Claude Security F7, 2026-11-17; Grant chose this over making
 * an unproven address unusable).
 *
 * Creating a club makes an account from an email address and a password
 * without proving the address (`POST /api/auth/signup`, `/password`). So
 * anyone could make an account on someone else's address. When the owner of
 * that mailbox later proved it (an email code, a reset link), the proof
 * landed on that account and signed them into it, while the password and
 * the sessions of whoever made it kept working.
 *
 * So the first proof of an address on an account that has never had one
 * takes the account back: any password set before the proof is dropped, and
 * every device is signed out, before the prover is signed in. The cost falls
 * on a real person who set a password and never confirmed it: after their
 * first email code they set the password again ("Forgot your password?").
 *
 * THE CONFIRMATION LINK DOES NOT PROTECT THE ACCOUNT (gap 2, Grant chose
 * "the link doesn't count as proof", 2026-11-18). It still marks the address
 * confirmed (`emailVerified`), but the take-back keys on `mailboxProven`,
 * which only a SIGN-IN through the address sets. Otherwise: someone makes an
 * account on Jenny's address, Jenny clicks the confirmation mail she never
 * asked for, and her later email-code sign-in lands in that account with the
 * maker's password still working. The cost: a real person who confirmed by
 * link and later signs in once by email code sets their password again.
 */
export function unprovenPasswordOn(member: { mailboxProven?: unknown; passwordHash?: unknown }): boolean {
  return member.mailboxProven !== true && typeof member.passwordHash === 'string' && member.passwordHash.length > 0;
}

/** Ends every session of this person, in every club (groups on, where the
 *  cut-off lives on each membership). The Member's own copy — the flag-off
 *  value — is the caller's to write in its own update. */
export async function signOutEveryClub(memberId: string, at: string): Promise<void> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return;
  for (const m of await listMembershipsForMember(memberId)) {
    await signOutEverywhereIn(m.groupId, memberId, at);
  }
}
