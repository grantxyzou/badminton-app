import { signValue, verifySignedValue } from '@/lib/auth';

/**
 * The secret a signed-out "let me in" ask hands its phone, SEALED with the
 * hour it is good for (docs/plans/one-way-in.md, step 4c).
 *
 * WHY. The ask answers every name the same 200 with a secret, but only an ask
 * under a name the club knows is STORED. The poll used to read the store, so
 * it answered `pending` for a stored ask and `none` for one that was never
 * written: ask under "Lin", poll once, and the answer said whether Lin is on
 * the club's list. Step 1 found it; this closes it.
 *
 * HOW. Every secret, stored or not, goes out signed with its expiry. The poll
 * opens it first: a seal the server made and that has not run out is `pending`
 * until the hour is up, whether or not anything was stored under it. Only a
 * stored ask can ever turn `approved`, so nothing is granted by the seal; it
 * only stops the poll from saying more than the ask did. A declined ask reads
 * as waiting until the hour ends, which is what "Ignore" means.
 *
 * The plaintext inside is the same random secret as before; only its sha256 is
 * stored. The signature is the session HMAC (`signValue`), so a caller cannot
 * mint a seal for a secret of its own, and nothing hangs on one if it could.
 */
const TTL_SECONDS = 60 * 60;

export function sealAskSecret(raw: string): string {
  return signValue({ s: raw }, TTL_SECONDS);
}

export type OpenedAskSecret =
  /** Made here, inside its hour. `raw` is what the store was keyed on. */
  | { kind: 'sealed'; raw: string }
  /** A bare secret from before the seal: read the store, as before. */
  | { kind: 'legacy'; raw: string }
  /** Forged, mangled or past its hour. */
  | { kind: 'dead' };

export function openAskSecret(wire: string): OpenedAskSecret {
  // A bare secret is 64 hex characters with no dot; a seal always has one.
  if (/^[0-9a-f]{64}$/.test(wire)) return { kind: 'legacy', raw: wire };
  const opened = verifySignedValue<{ s?: unknown }>(wire);
  return opened && typeof opened.s === 'string' && opened.s.length > 0 ? { kind: 'sealed', raw: opened.s } : { kind: 'dead' };
}
