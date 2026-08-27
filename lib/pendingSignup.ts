/**
 * The `pending_signup` cookie: an authenticated provider identity that has no
 * member yet.
 *
 * Resolution rule 4 (`new-account`) cannot finish inside the OAuth callback,
 * because it needs a display name from the user and must refuse names that are
 * already taken. So the callback parks the verified provider facts here and
 * redirects to the app, which collects a name and posts it to
 * `/api/auth/complete-signup`.
 *
 * IT IS SIGNED, NOT JUST HTTP-ONLY. The payload asserts "Google told us this
 * `sub` owns this verified address" — the exact facts `complete-signup` trusts
 * when it reserves an identity. An unsigned cookie would let anyone POST a
 * chosen `sub` and `email` and thereby claim an identity the provider never
 * vouched for. HttpOnly stops scripts reading it; the signature is what stops
 * the client WRITING it.
 *
 * Thirty minutes. It was ten, which turned out to be too short for the actual
 * task: people deliberate over the name their friends will see, get
 * interrupted, and come back. Expiring mid-decision strands them on a prompt
 * whose submit can only fail.
 *
 * The window is still short, and what it protects is modest: an unclaimed
 * provider identity in an HttpOnly, signed cookie, which grants nothing until
 * a name is chosen and can only ever create a NEW account — a name collision
 * is refused. Thirty minutes trades a little of that for a flow people can
 * actually finish.
 */
import { NextRequest, NextResponse } from 'next/server';
import { signValue, verifySignedValue } from '@/lib/auth';
import type { ProviderName } from '@/lib/oauthProviders';

export const PENDING_COOKIE = 'bpm_pending_signup';
const TTL_S = 30 * 60;
const COOKIE_PATH = '/bpm';

export interface PendingSignup {
  provider: ProviderName;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /**
   * Prefill for the name field. Apple sends a name ONLY on the very first
   * authorization and never again, so if it is not captured at that moment it
   * is gone permanently — which is why it rides along here rather than being
   * re-fetched later.
   */
  suggestedName: string | null;
}

export function setPendingSignup(res: NextResponse, value: PendingSignup): void {
  res.cookies.set(PENDING_COOKIE, signValue(value, TTL_S), {
    httpOnly: true,
    // Lax rather than Strict: this is read on the request that FOLLOWS a
    // cross-site provider redirect, and Strict would not be sent there.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TTL_S,
    path: COOKIE_PATH,
  });
}

export function readPendingSignup(req: NextRequest): PendingSignup | null {
  const value = verifySignedValue<PendingSignup>(req.cookies.get(PENDING_COOKIE)?.value);
  if (!value) return null;
  if (
    (value.provider !== 'google' && value.provider !== 'apple') ||
    typeof value.sub !== 'string' ||
    !value.sub
  ) {
    return null;
  }
  return value;
}

export function clearPendingSignup(res: NextResponse): void {
  res.cookies.set(PENDING_COOKIE, '', { httpOnly: true, path: COOKIE_PATH, maxAge: 0 });
}
