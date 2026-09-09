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
 * allowlist, the client beacon's type and the Slice-0 reader all derive from
 * these lists, so a kind cannot be added to the type without the server
 * accepting it, or accepted by the server without a reader counting it.
 */
export const CLIENT_KINDS = ['rec_card_tap', 'pick_added', 'pick_tried', 'pick_rated'] as const;
/** Written by the server only; `POST /api/events` refuses them. */
export const SERVER_KINDS = ['pick_served'] as const;
export const PICK_KINDS = ['pick_served', 'pick_added', 'pick_tried', 'pick_rated'] as const;

export type ClientKind = (typeof CLIENT_KINDS)[number];
export type ServerKind = (typeof SERVER_KINDS)[number];

/** Which optional payload fields each client kind may carry. Anything else
 *  is dropped: an open payload turns the container into a free-text sink. */
export const CLIENT_PAYLOAD: Record<ClientKind, ReadonlyArray<'catalogId' | 'engineVersion' | 'rating' | 'category'>> = {
  rec_card_tap: [],
  pick_added: ['catalogId', 'engineVersion', 'category'],
  pick_tried: ['catalogId', 'engineVersion', 'category'],
  pick_rated: ['catalogId', 'engineVersion', 'rating', 'category'],
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
