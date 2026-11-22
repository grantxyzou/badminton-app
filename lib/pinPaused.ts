import { NextResponse } from 'next/server';

/**
 * "Let's pause a moment — try again in 3:42" — the one answer a PIN check gives
 * while the name is paused (docs/plans/sign-in-redesign.md, step 2).
 *
 * It is given for EVERY name on the same schedule: an account's own lock
 * (`lib/pinLockout.ts`), the identical in-memory count for a name with no
 * PIN behind it, or a limit keyed on the name or the caller alone. So it
 * says nothing about whether a name has an account. 429 with `Retry-After`;
 * the client reads `error` first, because `rate_limited` is a 429 too.
 */
export function pinPaused(seconds: number): NextResponse {
  const s = Math.max(1, Math.ceil(seconds));
  return NextResponse.json({ error: 'pin_paused', retryAfter: s }, { status: 429, headers: { 'Retry-After': String(s) } });
}
