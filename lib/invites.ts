/**
 * Invite links and join codes — how a stranger gets into a group (Phase 3 of
 * `docs/superpowers/plans/2026-09-07-multi-group.md`).
 *
 * THE DIRECTION INVERSION FROM `lib/authMigration.ts`
 * --------------------------------------------------
 * Read that file's header first, then read this paragraph, because the next
 * person here will pattern-match to it and assume the protections carry over.
 * They do not. A migration link is single-use, lives five minutes, and is
 * deleted before the member is returned. An invite is the opposite on every
 * axis: MULTI-USE (a club shares one link with everybody), LONG-LIVED (it sits
 * in a group chat for a season), and RE-DISPLAYABLE (the admin opens the invite
 * card in March and expects the same link they shared in January).
 *
 * So neither TTL nor single-use contains this credential. Three things do:
 *
 *   - REGENERATE INVALIDATES. Minting a new pair deletes the old docs, so the
 *     link in a chat the club has outgrown stops working the moment the admin
 *     says so. This is the whole revocation story — there is no other.
 *   - THE PER-IP RATE LIMIT on `preview` and `join`. For the 32-hex token this
 *     is belt and braces; for the 8-character CODE it is the entire defence, the
 *     same argument `authMigration` makes for its 6 digits.
 *   - THE JOIN GATE. Redeeming either one requires a live `member_session`, so
 *     a leaked link admits an identified person to a roster, never an anonymous
 *     one. What it grants is `role: 'member'` and nothing more.
 *
 * PLAINTEXT AT REST, DELIBERATELY
 * -------------------------------
 * This is the one credential in the repo stored unhashed, and it is worth being
 * explicit about why rather than letting a future reader assume an oversight.
 * A hash cannot be re-displayed, and an invite the admin can only see once at
 * mint time is not an invite — it is a migration link with worse ergonomics.
 * What the hashed ID still buys is the LOOKUP: `sha256(secret)` as the doc id
 * makes "which group is this token for?" a point read in a container keyed by
 * `/id`, instead of a cross-partition query whose parameter name the mock store
 * would silently ignore (see the mock-store hazard in CLAUDE.md — an
 * unrecognised name means NO filter, which on a lookup means the wrong group).
 *
 * The plaintext lives on the SIBLING doc, never on the `Group` doc, which holds
 * only the two doc ids. That is the strip-canary rule applied structurally: a
 * route that returns a group verbatim — `GET /api/groups/current` does — cannot
 * leak a credential that was never on the object it returned.
 *
 * POINT READS ONLY, both directions: by hash to resolve a redemption, by the
 * id parked on the group doc to re-display. No query in this file.
 */
import { createHash, randomBytes, randomInt } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { readGroup } from '@/lib/groups';
import type { Group } from '@/lib/types';

/**
 * Ambiguous glyphs are absent by construction: no I, L, O, U, 0 or 1. A person
 * reading a code aloud in a gym never has to disambiguate, which is why
 * `normalizeCode` does NOT fold lookalikes — a fold that guesses wrong turns a
 * correctly-typed code into a rejection, and there is nothing here to confuse.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;

/** 16 bytes of hex. Not brute-forceable; the rate limit is belt and braces. */
const TOKEN_BYTES = 16;

export interface GroupInvite {
  /** Goes in the URL as `?join=<token>`. */
  token: string;
  /** Typed by hand when a link will not travel (a poster, a phone call). */
  code: string;
  createdAt: string;
}

/**
 * A sibling of the `Group` doc in the same GLOBAL container, keyed by the hash
 * of the secret it carries. `kind` is what tells the two apart on read-back;
 * nothing queries this container, so it is for legibility, not filtering.
 */
export interface InviteDoc {
  /** `invite:${sha256(token)}` or `code:${sha256(code)}`. */
  id: string;
  kind: 'invite' | 'code';
  groupId: string;
  /** The plaintext — see the header. Never returned to a non-admin. */
  secret: string;
  createdAt: string;
  createdBy: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function inviteDocId(token: string): string {
  return `invite:${sha256(token)}`;
}

export function codeDocId(code: string): string {
  return `code:${sha256(normalizeCode(code))}`;
}

/**
 * What a person typed, reduced to what was minted: case and separators are
 * noise, so `bpm-4k7t hj2q` and `BPM4K7THJ2Q` are the same code. Anything
 * outside A–Z and 0–9 is dropped, which covers spaces, hyphens and the
 * invisible characters a paste brings with it.
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function newCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

async function readInviteDoc(id: string): Promise<InviteDoc | undefined> {
  try {
    const { resource } = await getContainer('groups').item(id, id).read();
    return (resource as InviteDoc | undefined) ?? undefined;
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

async function deleteDoc(id: string): Promise<void> {
  try {
    await getContainer('groups').item(id, id).delete();
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 404;
}

/**
 * Mint a fresh link + code for a group and RETIRE the previous pair.
 *
 * Ordering is the revocation guarantee: the new docs are created first, the
 * group's pointers are moved, and only then are the old docs deleted. A
 * failure part-way leaves a group reachable by two pairs rather than none —
 * the safe direction, because the admin can regenerate again, whereas a group
 * with no working invite cannot be joined at all.
 */
export async function mintInvite(groupId: string, createdBy: string): Promise<GroupInvite | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return null;

  const createdAt = new Date().toISOString();
  const token = newToken();
  const code = newCode();
  const tokenDoc: InviteDoc = { id: inviteDocId(token), kind: 'invite', groupId, secret: token, createdAt, createdBy };
  const codeDoc: InviteDoc = { id: codeDocId(code), kind: 'code', groupId, secret: code, createdAt, createdBy };

  const container = getContainer('groups');
  await container.items.upsert(tokenDoc);
  await container.items.upsert(codeDoc);

  const previous = { token: group.inviteId, code: group.inviteCodeId };
  const next: Group = { ...group, inviteId: tokenDoc.id, inviteCodeId: codeDoc.id };
  await container.item(groupId, groupId).replace(next);

  if (previous.token && previous.token !== tokenDoc.id) await deleteDoc(previous.token);
  if (previous.code && previous.code !== codeDoc.id) await deleteDoc(previous.code);

  return { token, code, createdAt };
}

/**
 * The admin's view of the current pair. `null` when the group has never minted
 * one — a group created before this shipped, or one whose docs were deleted
 * out from under the pointers. The caller mints rather than treating it as an
 * error.
 */
export async function readInvite(groupId: string): Promise<GroupInvite | null> {
  const group = await readGroup(groupId);
  if (!group?.inviteId || !group.inviteCodeId) return null;
  const [tokenDoc, codeDoc] = await Promise.all([readInviteDoc(group.inviteId), readInviteDoc(group.inviteCodeId)]);
  if (!tokenDoc || !codeDoc) return null;
  return { token: tokenDoc.secret, code: codeDoc.secret, createdAt: tokenDoc.createdAt };
}

/**
 * Resolve a redemption to a group id, or `null`.
 *
 * ONE `null` FOR EVERY FAILURE — unknown secret, retired secret, closed group.
 * The caller must answer the same way for all three, the way `claimMigration`
 * makes absent, expired and already-used indistinguishable: a probe that can
 * tell "wrong token" from "right token, closed group" is an oracle for which
 * groups exist.
 */
export async function resolveInvite(raw: string, kind: 'invite' | 'code'): Promise<string | null> {
  const id = kind === 'invite' ? inviteDocId(raw.trim()) : codeDocId(raw);
  const doc = await readInviteDoc(id);
  if (!doc || doc.kind !== kind) return null;
  const group = await readGroup(doc.groupId);
  if (!group || group.closedAt) return null;
  return group.id;
}

/**
 * There is deliberately no `revokeInvite`. A group that closes keeps its
 * invite docs and they stop working anyway, because `resolveInvite` reads the
 * group and refuses a `closedAt` one — so deleting them would buy nothing and
 * add a second answer to "is this link live?". Regeneration is the revocation.
 */
