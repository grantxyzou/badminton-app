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
 * THE POINTER IS THE AUTHORITY, NOT THE DELETE.
 *
 * The first cut made retirement mean "the old doc was deleted", which put the
 * whole revocation story on a write that can fail. One 429 on that delete and
 * the link an admin had just revoked stayed live for good, with nothing able
 * to notice: a later regenerate reads the NEW pointers and so can never reach
 * the doc it orphaned.
 *
 * So `resolveInvite` requires the doc it found to be the one the group's
 * pointer currently names. A secret is live exactly while the group points at
 * it, which is a comparison on READ and therefore cannot fail open. Deleting
 * the old docs is now housekeeping — nice, not load-bearing.
 */
function pointerFor(group: Group, kind: 'invite' | 'code'): string | undefined {
  return kind === 'invite' ? group.inviteId : group.inviteCodeId;
}

function isConflict(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 409;
}

/**
 * Create a doc at an id nothing else holds, re-rolling the secret on a 409.
 *
 * `items.create`, never `upsert`. The 8-character code lives in a 30^8 space,
 * so a collision is vanishingly unlikely — but an upsert would resolve one by
 * silently overwriting the other club's doc, and anyone typing THEIR code
 * would then be admitted to THIS club. That is a cross-group admission, and
 * "unlikely" is not the standard for one. The same `items.create` refusal is
 * what makes roster names unique in `lib/groups.ts`.
 */
async function createUnique(make: () => InviteDoc): Promise<InviteDoc> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const doc = make();
    try {
      await getContainer('groups').items.create(doc);
      return doc;
    } catch (err) {
      if (!isConflict(err)) throw err;
    }
  }
  throw new Error('invite_mint_collision');
}

function tokenDocFor(groupId: string, createdBy: string, createdAt: string): InviteDoc {
  const token = newToken();
  return { id: inviteDocId(token), kind: 'invite', groupId, secret: token, createdAt, createdBy };
}

function codeDocFor(groupId: string, createdBy: string, createdAt: string): InviteDoc {
  const code = newCode();
  return { id: codeDocId(code), kind: 'code', groupId, secret: code, createdAt, createdBy };
}

/**
 * Move a group's invite pointers under an etag, re-reading on a lost race.
 *
 * `IfMatch` because this is a read-modify-write on a doc two admins can touch
 * at once, and the other writer may be `updateGroupSettings` rather than
 * another regenerate — a last-write-wins here reverts a club's settings save.
 * The backfill conditions its writes the same way for the same reason.
 */
async function movePointers(groupId: string, inviteId: string, inviteCodeId: string): Promise<void> {
  const container = getContainer('groups');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { resource } = await container.item(groupId, groupId).read();
    const current = resource as (Group & { _etag?: string }) | undefined;
    if (!current) return;
    const next = { ...current, inviteId, inviteCodeId };
    try {
      await container
        .item(groupId, groupId)
        .replace(next, current._etag ? { accessCondition: { type: 'IfMatch', condition: current._etag } } : undefined);
      return;
    } catch (err) {
      if ((err as { code?: number })?.code !== 412) throw err;
    }
  }
  throw new Error('invite_pointer_contended');
}

/**
 * Regenerate: a fresh pair, and the old one stops working.
 *
 * The new docs are created first and the pointers moved second, so a failure
 * part-way leaves the OLD pair live rather than none — the safe direction,
 * because an admin can regenerate again while a club with no working invite
 * cannot be joined at all. The old docs are deleted last and best-effort;
 * `resolveInvite`'s pointer check is what actually retires them.
 */
export async function mintInvite(groupId: string, createdBy: string): Promise<GroupInvite | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return null;

  const createdAt = new Date().toISOString();
  const tokenDoc = await createUnique(() => tokenDocFor(groupId, createdBy, createdAt));
  const codeDoc = await createUnique(() => codeDocFor(groupId, createdBy, createdAt));

  const previous = { token: group.inviteId, code: group.inviteCodeId };
  await movePointers(groupId, tokenDoc.id, codeDoc.id);

  if (previous.token && previous.token !== tokenDoc.id) await deleteDoc(previous.token);
  if (previous.code && previous.code !== codeDoc.id) await deleteDoc(previous.code);

  return { token: tokenDoc.secret, code: codeDoc.secret, createdAt };
}

/**
 * The pair to show the admin, MINTING ONLY WHAT IS MISSING.
 *
 * Not `readInvite() ?? mintInvite()`, which is what this was. That treated a
 * half-present pair as no pair and replaced BOTH — so a club that had lost one
 * of its two docs would have the link it posted in its group chat in January
 * destroyed by nothing more than an admin opening the invite card. A read verb
 * must not revoke a working credential, and a repair should repair rather than
 * start over.
 */
export async function ensureInvite(groupId: string, createdBy: string): Promise<GroupInvite | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return null;

  const [tokenDoc, codeDoc] = await Promise.all([
    group.inviteId ? readInviteDoc(group.inviteId) : Promise.resolve(undefined),
    group.inviteCodeId ? readInviteDoc(group.inviteCodeId) : Promise.resolve(undefined),
  ]);
  if (tokenDoc && codeDoc) {
    return { token: tokenDoc.secret, code: codeDoc.secret, createdAt: tokenDoc.createdAt };
  }

  const createdAt = new Date().toISOString();
  const token = tokenDoc ?? (await createUnique(() => tokenDocFor(groupId, createdBy, createdAt)));
  const code = codeDoc ?? (await createUnique(() => codeDocFor(groupId, createdBy, createdAt)));
  await movePointers(groupId, token.id, code.id);
  return { token: token.secret, code: code.secret, createdAt: token.createdAt };
}

/**
 * Resolve a redemption to a group id, or `null`.
 *
 * ONE `null` FOR EVERY FAILURE — unknown secret, retired secret, closed group,
 * a doc whose group no longer points at it. The caller must answer the same way
 * for all of them, the way `claimMigration` makes absent, expired and
 * already-used indistinguishable: a probe that can tell "wrong token" from
 * "right token, closed group" is an oracle for which groups exist.
 */
export async function resolveInvite(raw: string, kind: 'invite' | 'code'): Promise<string | null> {
  const id = kind === 'invite' ? inviteDocId(raw.trim()) : codeDocId(raw);
  const doc = await readInviteDoc(id);
  if (!doc || doc.kind !== kind) return null;
  const group = await readGroup(doc.groupId);
  if (!group || group.closedAt) return null;
  // Live exactly while the group points at it — see the note above.
  if (pointerFor(group, kind) !== doc.id) return null;
  return group.id;
}

/**
 * There is deliberately no `revokeInvite`. A group that closes keeps its
 * invite docs and they stop working anyway, because `resolveInvite` reads the
 * group and refuses a `closedAt` one — so deleting them would buy nothing and
 * add a second answer to "is this link live?". Regeneration is the revocation.
 */
