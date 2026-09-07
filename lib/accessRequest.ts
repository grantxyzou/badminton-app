import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * "I can't sign in — let me in."
 *
 * The self-service half of account recovery, and the reason it exists is a
 * support burden with a specific shape: players message Grant asking what their
 * PIN was, and a large share of them never set one. The app's own copy told
 * them to do that — "Ask the admin for a 6-digit code" was the entire recovery
 * path, with no way to ask from inside the app.
 *
 * WHY NOT EMAIL. `Member.email` is populated only by the OAuth and
 * email/password routes, all of which sit behind `NEXT_PUBLIC_FLAG_AUTH_PROVIDERS`
 * — which ships `false`. Nearly every member is PIN-only with no address on
 * file. Push is the channel that reaches this population; a reset link is not.
 *
 * SHAPE. Modelled on `lib/memberRecoveryCode.ts` (stored hashed on the member
 * doc, so it survives the cold starts that killed the old in-memory map) and on
 * `lib/authHandoff.ts`'s claim discipline (the secret is held only by the
 * device that asked, and claiming deletes it).
 *
 * The secret is what makes this DEVICE-BOUND, and that is load-bearing.
 * Approval is by name — Grant taps "let them in" without inspecting anything —
 * so without a secret held by the asking device, approving a request would
 * authorise whoever asked next. The device that created the request is the only
 * one that can redeem it.
 */

/** Long enough to walk over and ask, short enough that a stale approval is not
 *  sitting around. Deliberately longer than the 15-minute recovery code: this
 *  one waits on a human noticing a notification. */
const TTL_MS = 60 * 60 * 1000;

export interface StoredAccessRequest {
  /** sha256 of the secret. The secret itself is never stored, never logged,
   *  and never returned to anyone but the device that created it. */
  hash: string;
  expiresAt: number;
  /** When the admin approved. Absent = still waiting. */
  approvedAt?: number;
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Create a request. Returns the plaintext `secret` for the ASKING DEVICE ONLY,
 * plus the record to persist on the member doc.
 */
export function issueAccessRequest(): { secret: string; stored: StoredAccessRequest } {
  const secret = randomBytes(32).toString('hex');
  return { secret, stored: { hash: hash(secret), expiresAt: Date.now() + TTL_MS } };
}

/** Whether a stored request is still open — not expired, not yet approved. */
export function isPending(stored: StoredAccessRequest | undefined | null): boolean {
  if (!stored || typeof stored.expiresAt !== 'number') return false;
  if (Date.now() > stored.expiresAt) return false;
  return stored.approvedAt === undefined;
}

/**
 * Whether this device may now be signed in.
 *
 * Both halves are required: the secret proves it is the device that asked, and
 * `approvedAt` proves a human said yes. Constant-time comparison because the
 * secret is a bearer credential — a timing oracle here would let someone
 * recover it a byte at a time.
 */
export function canClaim(
  stored: StoredAccessRequest | undefined | null,
  candidate: string,
): boolean {
  if (!stored || typeof stored.hash !== 'string' || typeof stored.expiresAt !== 'number') {
    return false;
  }
  if (Date.now() > stored.expiresAt) return false;
  if (typeof stored.approvedAt !== 'number') return false;
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  const a = Buffer.from(hash(candidate), 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
