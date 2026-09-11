import { randomBytes } from 'crypto';
import { ensureContainer } from './cosmos';
import { groupScope } from './groupScope';
import type { EngagementEvent } from './types';

/**
 * The `events` container has ONE writer, here. It used to have two —
 * `POST /api/events` and an inline copy in `/api/recommend` for the
 * server-written `pick_served` — with their own id mints, their own
 * container bootstrap (one memoized, one not) and one of them typed as a
 * bare object literal, so a field added to `EngagementEvent` would have
 * compiled in one and silently diverged in the other. Same lesson CLAUDE.md
 * records for `memberResolve.ts`: when told "we already do that", check WHERE.
 *
 * The kinds live here too, ONCE, split by who may write them. The route's
 * allowlist and the client beacon's type both derive from these lists, so a
 * kind cannot be added to the type without the server accepting it.
 *
 * The other half of that sentence used to claim a kind could not be "accepted
 * by the server without a reader counting it". NOTHING ENFORCED THAT. Slice-0
 * matched the literal `rec_card_tap` and `PICK_KINDS`, so a kind added here
 * would have been validated, stored, group-scoped and tallied by nobody —
 * indistinguishable from a feature nobody used. That is now a build gate:
 * `__tests__/events-reader-coverage.test.ts` seeds one event of every kind and
 * fails if the Slice-0 body does not move.
 */
export const CLIENT_KINDS = [
  'rec_card_tap',
  'pick_added',
  'pick_tried',
  'pick_rated',
  'stats_open',
  'checkin_open',
] as const;
/** Written by the server only; `POST /api/events` refuses them. */
export const SERVER_KINDS = ['pick_served'] as const;
export const PICK_KINDS = ['pick_served', 'pick_added', 'pick_tried', 'pick_rated'] as const;

/**
 * Kinds whose SURFACE is gated by NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE, and which
 * therefore keep the "flag off leaves no live write endpoint behind" posture.
 *
 * The skill-funnel kinds are deliberately NOT here. `POST /api/events` used to
 * 404 wholesale on that flag, and the flag is dated for retirement — a
 * measurement that switches itself off on a date is not a measurement.
 */
export const VALUE_HUB_KINDS = [
  'rec_card_tap',
  'pick_added',
  'pick_tried',
  'pick_rated',
  'pick_served',
] as const;

/** Where a check-in was opened FROM. Bounded like `category`, never free text:
 *  the whole point is to tell which door the member actually used. */
export const CHECKIN_SOURCES = ['strip', 'trend', 'learn'] as const;
export type CheckInSource = (typeof CHECKIN_SOURCES)[number];

export type ClientKind = (typeof CLIENT_KINDS)[number];
export type ServerKind = (typeof SERVER_KINDS)[number];

export function isCheckInSource(v: unknown): v is CheckInSource {
  return typeof v === 'string' && (CHECKIN_SOURCES as readonly string[]).includes(v);
}

export function isValueHubKind(v: string): boolean {
  return (VALUE_HUB_KINDS as readonly string[]).includes(v);
}

/** Which optional payload fields each client kind may carry. Anything else
 *  is dropped: an open payload turns the container into a free-text sink. */
export const CLIENT_PAYLOAD: Record<
  ClientKind,
  ReadonlyArray<'catalogId' | 'engineVersion' | 'rating' | 'category' | 'source'>
> = {
  rec_card_tap: [],
  pick_added: ['catalogId', 'engineVersion', 'category'],
  pick_tried: ['catalogId', 'engineVersion', 'category'],
  pick_rated: ['catalogId', 'engineVersion', 'rating', 'category'],
  stats_open: [],
  checkin_open: ['source'],
};

export function isClientKind(v: unknown): v is ClientKind {
  return typeof v === 'string' && (CLIENT_KINDS as readonly string[]).includes(v);
}

// Lazy container bootstrap — real Cosmos doesn't auto-create containers (the
// mock store does, which is exactly how that difference hides until prod).
// Partitioned by `/memberId`: every read is "what did this member do".
let ready: Promise<void> | null = null;
function ensureEvents(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('events', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** For tests that reset the mock store between cases. */
export function __resetEventsForTests(): void {
  ready = null;
}

/**
 * Append one event. Deliberately `create`, never an upsert: the Slice-0
 * criterion asks whether a member interacted MORE THAN ONCE, which needs the
 * history. Throws on failure — the caller decides whether that is
 * load-bearing (the beacon route reports it; the recommend route logs it).
 *
 * Stamped with the group the tap happened in — `events` is GROUP-scoped so
 * that Slice-0 is a per-club readout and one club's engagement never reaches
 * another club's admin.
 */
export async function writeEvent(evt: Omit<EngagementEvent, 'id' | 'at' | 'groupId'>, groupId: string): Promise<EngagementEvent> {
  await ensureEvents();
  const record: EngagementEvent = {
    ...evt,
    id: randomBytes(16).toString('hex'),
    at: new Date().toISOString(),
  };
  return groupScope(groupId).create('events', record);
}
