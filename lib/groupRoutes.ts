/**
 * The few things every `app/api/groups/*` route needs, in one place so eight
 * handlers cannot drift on them.
 *
 * THE FLAG GATE IS A 404, NOT A 403. With `NEXT_PUBLIC_FLAG_MULTI_GROUP` off
 * there is exactly one club and the whole concept is absent — a 403 would say
 * "this exists and you may not have it", which is both untrue and a hint about
 * what ships next. `NEXT_PUBLIC_FLAG_STATS_V2` is the cautionary precedent for
 * the other half of this: when the flag comes off for good, these routes lose
 * the gate, not the deployment.
 *
 * The flag is read SERVER-side here. A client flag cannot protect a database —
 * every one of these routes writes memberships or mints a credential.
 */
import { NextResponse } from 'next/server';
import { isFlagOn } from '@/lib/flags';

export const groupsOn = (): boolean => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

/** The flag-off answer: the surface does not exist. */
export function featureOff(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export function rateLimited(): NextResponse {
  return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
}

/** A trimmed, length-checked string, or `null` when the input is not one. */
export function cleanString(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 40;
export const ROSTER_NAME_MIN = 1;
export const ROSTER_NAME_MAX = 40;

/**
 * How many groups one person may own. Not a product rule — a blast radius.
 * Creating a group is the one authenticated write here that provisions new
 * state per call, so it needs a ceiling that is not the rate limiter alone
 * (which resets on every cold start; see CLAUDE.md's in-memory limiter note).
 */
export const MAX_OWNED_GROUPS = 10;
