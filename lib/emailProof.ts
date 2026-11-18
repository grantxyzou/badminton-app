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
 * The confirmation link mailed at sign-up (`GET /api/auth/verify-email`) is
 * NOT treated this way: its click is the normal next step of a real sign-up,
 * and it signs nobody in.
 */
export function unprovenPasswordOn(member: { emailVerified?: unknown; passwordHash?: unknown }): boolean {
  return member.emailVerified !== true && typeof member.passwordHash === 'string' && member.passwordHash.length > 0;
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
