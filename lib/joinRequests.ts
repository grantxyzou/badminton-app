/**
 * "Ask to join" through the club's DOOR LINK (docs/plans/door-link.md).
 *
 * The door is the club's claim link (lib/claimLinks.ts), widened: someone who
 * scans a poster or taps a sticker types a name that is NOT on the roster, and
 * that becomes a join request here, waiting for an organiser. Nothing happens
 * until an organiser approves; approving creates the account, and the phone
 * that asked collects it with its secret and is signed in.
 *
 * The same discipline as `lib/accessRequest.ts`, which is the shape it follows:
 *
 * - DEVICE-BOUND. Approval is blind (the organiser taps Approve beside a name),
 *   so the request carries the sha256 of a secret only the asking phone holds.
 *   Approving lets in the phone that asked, and nobody else.
 * - SHORT-LIVED. An hour, like an access request: it waits on a person
 *   noticing a push, not on a calendar.
 * - BOUNDED. A club holds at most `MAX_OPEN_JOIN_REQUESTS` open at once; past
 *   that a new ask is not stored and the asker is answered the same, so a
 *   flood costs the organiser a declined list, not an unbounded doc.
 *
 * They live ON THE CLUB (`Group.joinRequests`) because a new person has no
 * Member doc to hold a request, and every write goes through
 * `updateJoinRequests` under the group's etag.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { readGroup, rosterNameHolder, updateJoinRequests } from '@/lib/groups';
import { adminAddToRoster } from '@/lib/roster';
import type { Group, Member, StoredJoinRequest } from '@/lib/types';

const TTL_MS = 60 * 60 * 1000;
export const MAX_OPEN_JOIN_REQUESTS = 10;
/** The same ceiling as an imported name (`POST /api/members`). */
export const MAX_JOIN_NAME = 50;

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Unexpired requests, waiting or approved-but-not-yet-collected. */
export function liveJoinRequests(group: Pick<Group, 'joinRequests'> | null | undefined, now = Date.now()): StoredJoinRequest[] {
  return (group?.joinRequests ?? []).filter(
    (r) => r && typeof r.hash === 'string' && typeof r.expiresAt === 'number' && now <= r.expiresAt,
  );
}

/** What an organiser is asked about: live, and nobody has said yes yet. */
export function pendingJoinRequests(group: Pick<Group, 'joinRequests'> | null | undefined, now = Date.now()): StoredJoinRequest[] {
  return liveJoinRequests(group, now).filter((r) => r.approvedAt === undefined);
}

/**
 * Store an ask. Returns the plaintext secret for the ASKING PHONE ONLY, or
 * `null` when the club is full of open asks (or gone). The caller answers the
 * same either way.
 */
export async function addJoinRequest(
  groupId: string,
  rawName: string,
  now = Date.now(),
): Promise<{ secret: string; request: StoredJoinRequest } | null> {
  const name = rawName.trim();
  if (!name || name.length > MAX_JOIN_NAME) return null;
  const secret = randomBytes(32).toString('hex');
  const request: StoredJoinRequest = {
    id: randomBytes(8).toString('hex'),
    name,
    hash: hash(secret),
    createdAt: new Date(now).toISOString(),
    expiresAt: now + TTL_MS,
  };
  const written = await updateJoinRequests(groupId, (open) => {
    // Expired asks are dropped on every write, so the list never grows stale.
    const live = open.filter((r) => typeof r.expiresAt === 'number' && now <= r.expiresAt);
    if (live.length >= MAX_OPEN_JOIN_REQUESTS) return null;
    return [...live, request];
  });
  return written ? { secret, request } : null;
}

/**
 * The request this secret belongs to, if any. Compared in constant time over
 * every entry, the way `findBySecret` does for access requests: the secret is
 * a bearer credential.
 */
export function findJoinBySecret(
  group: Pick<Group, 'joinRequests'> | null | undefined,
  candidate: string,
  now = Date.now(),
): StoredJoinRequest | null {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;
  const a = Buffer.from(hash(candidate), 'hex');
  let found: StoredJoinRequest | null = null;
  for (const r of liveJoinRequests(group, now)) {
    const b = Buffer.from(r.hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b) && !found) found = r;
  }
  return found;
}

export type ApproveJoinOutcome =
  | { outcome: 'approved'; memberId: string }
  | { outcome: 'not_found' }
  | { outcome: 'name_taken' };

/**
 * An organiser lets one person in. Creates the account (Member, membership,
 * name reservation) and marks the request, so the asking phone's next poll
 * signs it in.
 *
 * The request is marked approved FIRST, under the etag, so two organisers
 * tapping at once cannot create two accounts: the second finds it approved
 * and gets `not_found`. Only then is the account made; if that fails the mark
 * is taken back and the error thrown, so the request can be tried again.
 *
 * A name anyone on the roster holds, a REMOVED member's included, is
 * `name_taken`: `adminAddToRoster` would otherwise rejoin that removed person,
 * and a stranger at the door would be handed their old account.
 */
export async function approveJoinRequest(groupId: string, requestId: string, now = Date.now()): Promise<ApproveJoinOutcome> {
  const group = await readGroup(groupId);
  const target = pendingJoinRequests(group, now).find((r) => r.id === requestId);
  if (!group || group.closedAt || !target) return { outcome: 'not_found' };
  if (await rosterNameHolder(groupId, target.name)) return { outcome: 'name_taken' };

  const marked = await updateJoinRequests(groupId, (open) => {
    const mine = open.find((r) => r.id === requestId && r.approvedAt === undefined && now <= r.expiresAt);
    if (!mine) return null;
    return open.map((r) => (r.id === requestId ? { ...r, approvedAt: now } : r));
  });
  if (!marked) return { outcome: 'not_found' };

  let memberId: string;
  try {
    const { member, created } = await adminAddToRoster(groupId, target.name, new Date(now).toISOString());
    if (!created) {
      // The name was claimed between the check and the create: someone else
      // holds it now. Not this person's account, so never hand it over.
      await unmark(groupId, requestId);
      return { outcome: 'name_taken' };
    }
    memberId = member.id;
  } catch (err) {
    await unmark(groupId, requestId);
    throw err;
  }

  await updateJoinRequests(groupId, (open) => open.map((r) => (r.id === requestId ? { ...r, memberId } : r)));
  return { outcome: 'approved', memberId };
}

async function unmark(groupId: string, requestId: string): Promise<void> {
  await updateJoinRequests(groupId, (open) =>
    open.map((r) => {
      if (r.id !== requestId) return r;
      const { approvedAt: _a, ...rest } = r;
      return rest;
    }),
  ).catch((err) => console.error('joinRequests: could not take back an approval mark', err));
}

/** An organiser says no. The asking phone's next poll answers `none`. */
export async function declineJoinRequest(groupId: string, requestId: string): Promise<boolean> {
  const written = await updateJoinRequests(groupId, (open) =>
    open.some((r) => r.id === requestId) ? open.filter((r) => r.id !== requestId) : null,
  );
  return !!written;
}

export type CollectOutcome =
  | { status: 'approved'; member: Member }
  | { status: 'pending' }
  | { status: 'none' };

/**
 * The asking phone polls with its secret. Approved and the account made: the
 * request is removed FIRST (so a replay finds nothing) and the member handed
 * back for the caller to sign in. Still waiting: `pending`. Anything else,
 * including a secret that matches nothing: `none`.
 */
export async function collectJoinRequest(groupId: string, secret: string, now = Date.now()): Promise<CollectOutcome> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return { status: 'none' };
  const mine = findJoinBySecret(group, secret, now);
  if (!mine) return { status: 'none' };
  if (mine.approvedAt === undefined || !mine.memberId) return { status: 'pending' };

  const memberId = mine.memberId;
  const burned = await updateJoinRequests(groupId, (open) =>
    open.some((r) => r.id === mine.id && r.memberId === memberId) ? open.filter((r) => r.id !== mine.id) : null,
  );
  if (!burned) return { status: 'none' };
  const { resource } = await getContainer('members').item(memberId, memberId).read<Member>();
  return resource ? { status: 'approved', member: resource } : { status: 'none' };
}
