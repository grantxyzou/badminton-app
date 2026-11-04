/**
 * GET /api/auth/me — "who am I?", answered from the `member_session` cookie.
 *
 * WHY THIS HAD TO EXIST
 * ---------------------
 * After a provider callback the server knows exactly who signed in, but the
 * CLIENT had no way to ask. `GET /api/members/me` requires a `?name=` and only
 * confirms a name you already have; `GET /api/auth/methods` is cookie-keyed but
 * returns credentials, not identity. So a returning Google user landed with a
 * valid session cookie, no `badminton_identity` in localStorage, and an app
 * that rendered the signed-out view. This closes that.
 *
 * THREE STATES, NOT TWO
 * ---------------------
 *   { signedIn: true,  name }  — the cookie is valid
 *   { signedIn: false, name: null } — KNOWN to be signed out
 *   { signedIn: null,  name: null } — UNKNOWN (throttled, or the re-read failed)
 *
 * The client must write identity only on `true`, and must NEVER clear on
 * `false` or `null`. `null` is the "unknown ≠ known-false" rule: answering a
 * rate-limited read as "signed out" would let a burst of requests log someone
 * out of their own app.
 *
 * WHY NOT FOLDED INTO /api/auth/methods
 * -------------------------------------
 * `methods` does a Cosmos point read plus a `listIdentitiesForMember` query on
 * every call, and its budget is already spent by `ProviderButtons` on every
 * anonymous Profile mount. Identity restore must not queue behind that or fail
 * on a Cosmos throttle — and `methods`' own degraded shape omits identity
 * entirely, which would read as signed-out. That is the exact bug class this
 * endpoint exists to fix.
 *
 * The name in the cookie is a snapshot from sign-in time, which is fine here:
 * `finishOAuthCallback` issues `?signedIn=1` on the SAME response that mints the
 * cookie, so on this path the name was read from Cosmos moments earlier.
 *
 * Deliberately returns no `memberId` — nothing client-side needs it, and an id
 * in a client payload is an id to try elsewhere.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { readLiveMemberSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-me:${ip}`, 30, 60 * 1000)) {
    // UNKNOWN, not signed-out. See the docblock.
    return NextResponse.json({ signedIn: null, name: null });
  }

  // The signature, then ONE point read: a session "Sign out everywhere" cut
  // off is signed out here too (docs/plans/claim-your-name.md). Without it the
  // create-a-club page read a signed-out phone as signed in and skipped its
  // account step, straight into a POST that refuses the same cookie. A failed
  // read is UNKNOWN, like a throttle — never "signed out".
  const live = await readLiveMemberSession(req);
  if (live.status === 'unknown') return NextResponse.json({ signedIn: null, name: null });
  if (live.status === 'none') return NextResponse.json({ signedIn: false, name: null });

  return NextResponse.json({ signedIn: true, name: live.session.name });
}
