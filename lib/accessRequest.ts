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
 * Grant taps "let them in" without inspecting anything, so without a secret
 * held by the asking device, approving a request would authorise whoever asked
 * next. The device that created the request is the only one that can redeem it.
 *
 * ONE REQUEST PER DEVICE, NOT ONE PER NAME (security finding F2, 2026-09-14).
 * The first cut kept a single `accessRequest` on the member and let the first
 * ask win. That only moved the hole: someone who knows the name (names are
 * enumerable) asks first, Lin's real request is silently dropped, and Grant's
 * approval of "Lin" hands the session to the stranger. Now every ask is its own
 * entry in `accessRequests`, nobody can displace anybody, and the admin approves
 * a request by ID — and only when it is the ONLY one open for that person.
 * Two open requests for one name are indistinguishable by design (no device
 * strings — they would be theatre), so the admin's one action there is to clear
 * them and have the person ask again in front of him.
 */

/** Long enough to walk over and ask, short enough that a stale approval is not
 *  sitting around. Deliberately longer than the 15-minute recovery code: this
 *  one waits on a human noticing a notification. */
const TTL_MS = 60 * 60 * 1000;

/** Open requests kept per member. "First ask wins" used to bound the doc by
 *  accident; a list needs a ceiling of its own. Past it a new ask is not stored
 *  (it cannot displace one that is), which costs a spammer's victim nothing
 *  extra: two open requests already block approval. */
export const MAX_OPEN_REQUESTS = 5;

/** The id a legacy single `accessRequest` reads as. One per member at most. */
export const LEGACY_ID = 'legacy';

export interface StoredAccessRequest {
  /** Random, public-safe handle the admin approves by. Absent only on a legacy
   *  single `accessRequest`, which reads as `LEGACY_ID`. Never the hash — the
   *  hash must not leave the server. */
  id?: string;
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
  return {
    secret,
    stored: { id: randomBytes(8).toString('hex'), hash: hash(secret), expiresAt: Date.now() + TTL_MS },
  };
}

interface HasRequests {
  accessRequest?: StoredAccessRequest;
  accessRequests?: StoredAccessRequest[];
}

function isLive(r: unknown): r is StoredAccessRequest {
  const x = r as StoredAccessRequest | null;
  return !!x && typeof x.hash === 'string' && typeof x.expiresAt === 'number' && Date.now() <= x.expiresAt;
}

/**
 * Every unexpired request on a member — waiting or approved-but-unclaimed —
 * with the legacy single object folded in, the way `normalizeBirdUsages` reads
 * the old `birdUsage`. Read-tolerated, never written: the next write replaces
 * both fields with the list.
 */
export function openRequests(member: HasRequests | null | undefined): Array<StoredAccessRequest & { id: string }> {
  if (!member) return [];
  const out: Array<StoredAccessRequest & { id: string }> = [];
  if (isLive(member.accessRequest)) {
    out.push({ ...member.accessRequest, id: member.accessRequest.id ?? LEGACY_ID });
  }
  if (Array.isArray(member.accessRequests)) {
    for (const r of member.accessRequests) {
      if (isLive(r) && typeof r.id === 'string') out.push({ ...r, id: r.id });
    }
  }
  return out;
}

/** Open requests nobody has approved yet — what the admin is asked about. */
export function pendingRequests(member: HasRequests | null | undefined) {
  return openRequests(member).filter((r) => r.approvedAt === undefined);
}

/**
 * The request this secret belongs to, if any.
 *
 * The secret is a bearer credential, so hashes are compared in constant time —
 * a timing oracle would let someone recover it a byte at a time — and every
 * entry is checked rather than stopping at the first match. Finding the entry
 * is only half of signing in: the claim route also requires its `approvedAt`,
 * the proof that a human said yes.
 */
export function findBySecret(
  member: HasRequests | null | undefined,
  candidate: string,
): (StoredAccessRequest & { id: string }) | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  const a = Buffer.from(hash(candidate), 'hex');
  let found: (StoredAccessRequest & { id: string }) | null = null;
  for (const r of openRequests(member)) {
    const b = Buffer.from(r.hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b) && !found) found = r;
  }
  return found;
}
