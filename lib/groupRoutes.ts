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
import type { GroupSettings } from '@/lib/types';

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

/**
 * The shape a group id is allowed to have: `'bpm'`, or the 16 hex characters
 * `newGroupId()` mints. Checked at the ONE door that takes one from a request
 * body (`POST /api/groups/switch`), because from there it flows into
 * `groupScope()` and into log lines — an unconstrained string is how a caller
 * gets to choose part of a query parameter value and part of a log record.
 */
export function isGroupIdShape(value: string): boolean {
  return /^[a-z0-9]{2,32}$/.test(value);
}

/**
 * What a group's settings look like to one of its MEMBERS.
 *
 * An ALLOWLIST, not a strip. `GroupSettings` also carries
 * `eTransferRecipient` — the organiser's name and email, which security rule 10
 * calls payment data and every other reader of gates behind admin. Spreading
 * and deleting that one field would be correct today and wrong the next time
 * the type grows a field, and it grows on roughly every phase of this plan. An
 * admin reads the whole object through `GET /api/admin/settings`, which is
 * where it belongs.
 */
export function memberVisibleSettings(settings: GroupSettings): Pick<GroupSettings, 'maxPlayers' | 'skipDates'> {
  return { maxPlayers: settings.maxPlayers, skipDates: settings.skipDates };
}
