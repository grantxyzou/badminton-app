import { randomBytes } from 'crypto';
import { getContainer } from './cosmos';

/**
 * THE DATABASE WORK A FAILED GUESS COSTS, PAID FOR A NAME NOBODY HOLDS
 * (Claude Security, gap 3 of the 2026-11-17 scan; Grant chose "pad it",
 * 2026-11-18).
 *
 * OWASP's Authentication Cheat Sheet asks a login to "go through the same
 * process no matter what the user or the password is". `FAKE_HASH` already
 * makes the scrypt the same. But a wrong PIN or code against a REAL account
 * also reads that account and writes its counter (`claimPinAttempt`,
 * `noteRecoveryCodeFailure`, `noteEmailCodeFailure`), while a name nobody
 * holds stopped after the scrypt. Timed over many tries, the slower answer
 * named the real member.
 *
 * So an unknown name pays a comparable number of round trips: point reads of
 * a member id that cannot exist. A read is not a write, so this narrows the
 * gap rather than measuring it to the millisecond; the rate limits are what
 * stop anyone from averaging over enough tries to see what is left.
 */
export const PAD_ROUND_TRIPS = 3;

export async function padMissingAccount(roundTrips: number = PAD_ROUND_TRIPS): Promise<void> {
  const members = getContainer('members');
  for (let i = 0; i < roundTrips; i++) {
    const id = `pad-${randomBytes(8).toString('hex')}`;
    try {
      await members.item(id, id).read();
    } catch {
      // A failed pad read changes nothing: the answer is already decided.
    }
  }
}
