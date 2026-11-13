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
import {
  addMembership,
  listMembershipsForMember,
  readGroup,
  readMembership,
  rosterNameHolder,
  RosterNameTakenError,
  setMembershipRegular,
  updateJoinRequests,
} from '@/lib/groups';
import { adminAddToRoster } from '@/lib/roster';
import { isUnclaimed } from '@/lib/claimLinks';
import { listIdentitiesForMember, reassignIdentity } from '@/lib/authIdentity';
import type { Group, Member, StoredJoinRequest } from '@/lib/types';

const TTL_MS = 60 * 60 * 1000;
export const MAX_OPEN_JOIN_REQUESTS = 10;

/**
 * An ask from a SIGNED-IN account (docs/plans/one-way-in.md, step 4) waits
 * fourteen days, not an hour: the person can close the app, so the request
 * waits on the organiser's week, not on a phone kept open. Fourteen is also
 * when a never-approved account is cleaned up (step 6).
 */
export const ACCOUNT_ASK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** Open account asks one club may hold: a full Saturday of people, not a flood. */
export const MAX_OPEN_ACCOUNT_ASKS = 50;
/** The same ceiling as an imported name (`POST /api/members`). */
export const MAX_JOIN_NAME = 50;

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Unexpired requests, waiting or approved-but-not-yet-collected. */
export function liveJoinRequests(group: Pick<Group, 'joinRequests'> | null | undefined, now = Date.now()): StoredJoinRequest[] {
  return (group?.joinRequests ?? []).filter(
    (r) =>
      r &&
      (typeof r.hash === 'string' || typeof r.askedBy === 'string') &&
      typeof r.expiresAt === 'number' &&
      now <= r.expiresAt,
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
    // An account's ask has no secret: it is never found by one.
    if (typeof r.hash !== 'string') continue;
    const b = Buffer.from(r.hash, 'hex');
    if (a.length === b.length && timingSafeEqual(a, b) && !found) found = r;
  }
  return found;
}

export type ApproveJoinOutcome =
  | { outcome: 'approved'; memberId: string; name: string }
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
export async function approveJoinRequest(
  groupId: string,
  requestId: string,
  now = Date.now(),
  opts: { regular?: boolean } = {},
): Promise<ApproveJoinOutcome> {
  const group = await readGroup(groupId);
  const target = pendingJoinRequests(group, now).find((r) => r.id === requestId);
  if (!group || group.closedAt || !target) return { outcome: 'not_found' };
  if (typeof target.askedBy === 'string') return approveAccountAsk(groupId, target, now, opts);
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

  if (opts.regular === true) await setMembershipRegular(groupId, memberId, true);
  await updateJoinRequests(groupId, (open) =>
    open.map((r) => (r.id === requestId ? { ...r, memberId, ...(opts.regular === true ? { regular: true } : {}) } : r)),
  );
  return { outcome: 'approved', memberId, name: target.name };
}

/**
 * Approve an ask from a signed-in account: add THAT account to the club,
 * under the name it gave, as a regular or a drop-in. The request is taken off
 * the club FIRST, under the etag, so two organisers tapping at once add the
 * person once; the second finds nothing. If the membership cannot be added
 * (the name was taken meanwhile), the request is put back.
 */
async function approveAccountAsk(
  groupId: string,
  target: StoredJoinRequest,
  now: number,
  opts: { regular?: boolean },
): Promise<ApproveJoinOutcome> {
  const memberId = target.askedBy!;
  // An account linked away to an imported name (step 4b) is retired: never add it.
  const { resource: asker } = await getContainer('members').item(memberId, memberId).read<Member>();
  if (!asker || asker.active !== true) return { outcome: 'not_found' };
  const holder = await rosterNameHolder(groupId, target.name);
  if (holder && holder !== memberId) return { outcome: 'name_taken' };

  const taken = await updateJoinRequests(groupId, (open) =>
    open.some((r) => r.id === target.id && r.approvedAt === undefined && now <= r.expiresAt)
      ? open.filter((r) => r.id !== target.id)
      : null,
  );
  if (!taken) return { outcome: 'not_found' };

  try {
    await addMembership({ groupId, memberId, name: target.name, joinedVia: 'link', joinedAt: new Date(now).toISOString() });
  } catch (err) {
    await updateJoinRequests(groupId, (open) => (open.some((r) => r.id === target.id) ? null : [...open, target]));
    if (err instanceof RosterNameTakenError) return { outcome: 'name_taken' };
    throw err;
  }
  if (opts.regular === true) await setMembershipRegular(groupId, memberId, true);
  return { outcome: 'approved', memberId, name: target.name };
}

export type AccountAskOutcome =
  | { outcome: 'asked'; request: StoredJoinRequest }
  | { outcome: 'already_in' }
  | { outcome: 'full' };

/**
 * A signed-in account asks to join a club through its link. One open ask per
 * account per club: asking again (a new name, or the same) replaces it and
 * keeps its place. The account keeps a pointer (`Member.joinAsks`) so the
 * waiting screen reads its own asks without scanning every club.
 */
export async function addAccountJoinRequest(
  groupId: string,
  memberId: string,
  rawName: string,
  now = Date.now(),
): Promise<AccountAskOutcome | null> {
  const name = rawName.trim();
  if (!name || name.length > MAX_JOIN_NAME) return null;
  const existing = await readMembership(groupId, memberId);
  if (existing?.status === 'active') return { outcome: 'already_in' };

  let request: StoredJoinRequest | null = null;
  let full = false;
  const written = await updateJoinRequests(groupId, (open) => {
    const live = open.filter((r) => typeof r.expiresAt === 'number' && now <= r.expiresAt);
    const mine = live.find((r) => r.askedBy === memberId && r.approvedAt === undefined);
    if (mine) {
      request = { ...mine, name, expiresAt: now + ACCOUNT_ASK_TTL_MS };
      return live.map((r) => (r.id === mine.id ? request! : r));
    }
    if (live.filter((r) => typeof r.askedBy === 'string').length >= MAX_OPEN_ACCOUNT_ASKS) {
      full = true;
      return null;
    }
    request = {
      id: randomBytes(8).toString('hex'),
      name,
      askedBy: memberId,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + ACCOUNT_ASK_TTL_MS,
    };
    return [...live, request];
  });
  if (full) return { outcome: 'full' };
  if (!written || !request) return null;
  await rememberAsk(memberId, groupId, (request as StoredJoinRequest).id, now);
  return { outcome: 'asked', request };
}

/** Keep the account's pointer to its ask, dropping ones older than an ask lives. */
async function rememberAsk(memberId: string, groupId: string, requestId: string, now: number): Promise<void> {
  const container = getContainer('members');
  for (let attempt = 0; attempt < 3; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return;
    const kept = (resource.joinAsks ?? []).filter(
      (a) => a.groupId !== groupId && now - Date.parse(a.askedAt) < ACCOUNT_ASK_TTL_MS,
    );
    const next = { ...resource, joinAsks: [...kept, { groupId, requestId, askedAt: new Date(now).toISOString() }] };
    try {
      if (typeof resource._etag === 'string') {
        await container.item(memberId, memberId).replace(next, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      } else {
        await container.items.upsert(next);
      }
      return;
    } catch (err) {
      if ((err as { code?: number })?.code === 412) continue;
      throw err;
    }
  }
}

export type AskState = 'waiting' | 'in' | 'closed';

export interface AccountAsk {
  groupId: string;
  club: string;
  name: string | null;
  state: AskState;
}

/**
 * Where each of this account's asks stands: `in` (the organiser let them in),
 * `waiting`, or `closed` (declined, expired, or the club is gone). It is the
 * person's OWN asks, read through their own pointer, so saying "declined" out
 * loud tells them nothing about anyone else.
 */
export async function accountAsks(member: Pick<Member, 'id' | 'joinAsks'>, now = Date.now()): Promise<AccountAsk[]> {
  const out: AccountAsk[] = [];
  for (const ask of member.joinAsks ?? []) {
    const group = await readGroup(ask.groupId);
    if (!group || group.closedAt) continue;
    const membership = await readMembership(ask.groupId, member.id);
    if (membership?.status === 'active') {
      out.push({ groupId: group.id, club: group.name, name: membership.name, state: 'in' });
      continue;
    }
    const open = pendingJoinRequests(group, now).find((r) => r.id === ask.requestId && r.askedBy === member.id);
    out.push({ groupId: group.id, club: group.name, name: open?.name ?? null, state: open ? 'waiting' : 'closed' });
  }
  return out;
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

export type LinkJoinOutcome =
  | { outcome: 'linked'; memberId: string; name: string }
  | { outcome: 'not_found' }
  | { outcome: 'not_linkable' };

/**
 * Who an account's ask could be LINKED to (docs/plans/one-way-in.md, step
 * 4b): the club member already holding the asked-for name, when that member
 * has never signed in (`isUnclaimed`: imported by an organiser, no PIN,
 * password or provider). Null for anyone who has signed in: an account with
 * its own way in is never handed to somebody else.
 */
export async function linkableHolder(
  groupId: string,
  request: Pick<StoredJoinRequest, 'askedBy' | 'name'>,
): Promise<{ memberId: string; name: string } | null> {
  if (typeof request.askedBy !== 'string') return null;
  const holderId = await rosterNameHolder(groupId, request.name);
  if (!holderId || holderId === request.askedBy) return null;
  const { resource } = await getContainer('members').item(holderId, holderId).read<Member>();
  if (!resource || resource.active !== true || !isUnclaimed(resource)) return null;
  return { memberId: holderId, name: request.name };
}

/**
 * "This is Lin from your list" (Grant, 2026-11-13: imported names come in the
 * same way as everyone, and the organiser links them). The asking account is
 * a fresh sign-in; the imported member holds the history. Linking moves every
 * sign-in identity of the fresh account onto the imported member, gives the
 * member the account's email, and retires the fresh account (`mergedInto`),
 * whose phone is signed in as the member on its next check
 * (`GET /api/groups/ask`).
 *
 * Refused (`not_linkable`) unless the holder has never signed in and the
 * asking account is in no club at all: two accounts that both have a life are
 * never merged here. The ask is taken off the club FIRST, under the etag, so
 * two organisers cannot link twice; a failure part-way puts it back.
 */
export async function linkJoinRequest(
  groupId: string,
  requestId: string,
  now = Date.now(),
  opts: { regular?: boolean } = {},
): Promise<LinkJoinOutcome> {
  const group = await readGroup(groupId);
  const target = pendingJoinRequests(group, now).find((r) => r.id === requestId);
  if (!group || group.closedAt || !target || typeof target.askedBy !== 'string') return { outcome: 'not_found' };
  const askerId = target.askedBy;
  const holder = await linkableHolder(groupId, target);
  if (!holder) return { outcome: 'not_linkable' };

  const container = getContainer('members');
  const { resource: asker } = await container.item(askerId, askerId).read<Member & { _etag?: string }>();
  if (!asker || asker.active !== true) return { outcome: 'not_linkable' };
  const memberships = (await listMembershipsForMember(askerId)).filter((m) => m.status === 'active');
  if (memberships.length > 0) return { outcome: 'not_linkable' };

  const taken = await updateJoinRequests(groupId, (open) =>
    open.some((r) => r.id === target.id && r.approvedAt === undefined && now <= r.expiresAt)
      ? open.filter((r) => r.id !== target.id)
      : null,
  );
  if (!taken) return { outcome: 'not_found' };

  try {
    for (const identity of await listIdentitiesForMember(askerId)) {
      await reassignIdentity(identity, holder.memberId);
    }
    const { resource: member } = await container.item(holder.memberId, holder.memberId).read<Member>();
    if (!member) throw new Error('linked member vanished');
    const providers = new Set([...(member.linkedProviders ?? []), ...(asker.linkedProviders ?? [])]);
    await container.items.upsert({
      ...member,
      ...(providers.size > 0 ? { linkedProviders: [...providers] } : {}),
      ...(!member.email && asker.email ? { email: asker.email, emailVerified: asker.emailVerified === true } : {}),
    });
    const { email: _e, emailVerified: _v, joinAsks: _j, linkedProviders: _l, _etag: _t, ...rest } = asker;
    await container.items.upsert({ ...rest, active: false, mergedInto: holder.memberId, mergedInGroup: groupId });
  } catch (err) {
    await updateJoinRequests(groupId, (open) => (open.some((r) => r.id === target.id) ? null : [...open, target]));
    throw err;
  }
  if (opts.regular === true) await setMembershipRegular(groupId, holder.memberId, true);
  return { outcome: 'linked', memberId: holder.memberId, name: holder.name };
}
