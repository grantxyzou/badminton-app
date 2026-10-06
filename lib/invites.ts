/**
 * One-time invites — how a stranger gets into a group
 * (docs/plans/one-time-invites.md; the multi-use design this replaced is in
 * Phase 3 of `docs/superpowers/plans/2026-09-07-multi-group.md`).
 *
 * Grant, 2026-10-06: "lets make it one time used link." An invite is a LINK
 * and a CODE that admit one person, once, within seven days. The admin makes
 * one per person; the weekly sign-up share carries no invite at all.
 *
 * THE CLUB RECORD IS THE AUTHORITY, NOT THE INVITE DOC
 * ---------------------------------------------------
 * A `Group` lists its live invites (`invites`). An invite is live exactly
 * while it is on that list and unexpired, which is a comparison on READ and
 * cannot fail open. Using one REMOVES it from the list under an `IfMatch`
 * etag condition, so two sign-ups racing on the same link cannot both get in:
 * the second replace is a 412, and on re-read the entry is gone. The invite
 * docs are then stamped `usedAt`/`usedBy` and their plaintext dropped. The
 * multi-use design kept the same shape (a pointer on the group doc was the
 * authority, the delete was housekeeping); single-use only adds that the
 * pointer is consumed.
 *
 * CLAIM FIRST, RELEASE ON REFUSAL. The sign-up terminals claim before they
 * create the account, and `release()` puts the invite back if the sign-up
 * then fails for another reason (name taken, a database error). Claiming
 * after success would let two sign-ups through on one link.
 *
 * STILL CONTAINED BY: the per-IP rate limit on `preview` and `join` (for the
 * 8-character code it is the entire defence, the same argument
 * `lib/authMigration.ts` makes for its 6 digits), and the fact that redeeming
 * an invite makes an identified account, never an anonymous one.
 *
 * PLAINTEXT AT REST, WHILE LIVE. The secret sits on the invite doc so the
 * admin can re-copy a link they made yesterday — a hash cannot be
 * re-displayed, and a link an admin can only see once is a migration link
 * with worse ergonomics. It is dropped the moment the invite is used. What
 * the hashed ID buys is the LOOKUP: `sha256(secret)` as the doc id makes
 * "which group is this for?" a point read in a container keyed by `/id`,
 * instead of a cross-partition query whose parameter name the mock store
 * would silently ignore. The plaintext never sits on the `Group` doc, which
 * holds only ids, so a route that returns a group verbatim (`GET
 * /api/groups/current` does) cannot leak a working invite.
 *
 * POINT READS ONLY: by hash to resolve, by the ids on the list to display.
 * No query in this file.
 */
import { createHash, randomBytes, randomInt } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { readGroup } from '@/lib/groups';
import type { Group, PendingInvite } from '@/lib/types';

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

/** Seven days. An unused link cannot be found and used months later. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface GroupInvite {
  /** The link doc's id; what `revokeInvite` takes. */
  id: string;
  /** Goes in the URL as `?join=<token>`. */
  token: string;
  /** Typed by hand when a link will not travel (WeChat, a phone call). */
  code: string;
  createdAt: string;
  expiresAt: string;
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
  /**
   * The link doc's id, on BOTH docs of a pair: it is what the group's list
   * names, so a claim by code can find and consume the same entry as a claim
   * by link. A doc with no `pairId` is a legacy club-wide one and never
   * resolves.
   */
  pairId: string;
  /** The plaintext — see the header. Absent once used. */
  secret?: string;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

/** What a sign-up holds between claiming an invite and finishing. */
export interface InviteClaim {
  groupId: string;
  /** The sign-up was refused for another reason: put the invite back. */
  release(): Promise<void>;
  /** The account exists: record who used it and drop the plaintext. */
  finalize(usedBy: string, now?: number): Promise<void>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function inviteDocId(token: string): string {
  return `invite:${sha256(token)}`;
}

function codeDocId(code: string): string {
  return `code:${sha256(normalizeCode(code))}`;
}

/**
 * What a person typed, reduced to what was minted: case and separators are
 * noise, so `bpm-4k7t hj2q` and `BPM4K7THJ2Q` are the same code. Anything
 * outside A–Z and 0–9 is dropped, which covers spaces, hyphens and the
 * invisible characters a paste brings with it.
 */
function normalizeCode(raw: string): string {
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

const live = (entries: PendingInvite[] | undefined, now: number): PendingInvite[] =>
  (entries ?? []).filter((e) => Date.parse(e.expiresAt) > now);

/**
 * Rewrite the group's live-invite list under an etag, re-reading on a lost
 * race. `IfMatch` because this is a read-modify-write on a doc two admins and
 * any number of sign-ups can touch at once, and the other writer may be
 * `updateGroupSettings` — a last-write-wins here reverts a club's settings
 * save. The backfill conditions its writes the same way for the same reason.
 *
 * `edit` sees the CURRENT live list and answers the next one, or `null` to
 * stop without writing (the entry it wanted is already gone). Expired entries
 * are pruned on every write, so the list never grows past what is live.
 */
async function editInvites(
  groupId: string,
  now: number,
  edit: (entries: PendingInvite[]) => PendingInvite[] | null,
): Promise<boolean> {
  const container = getContainer('groups');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { resource } = await container.item(groupId, groupId).read();
    const current = resource as (Group & { _etag?: string }) | undefined;
    if (!current || current.closedAt) return false;
    const next = edit(live(current.invites, now));
    if (next === null) return false;
    try {
      await container
        .item(groupId, groupId)
        .replace({ ...current, invites: next }, current._etag ? { accessCondition: { type: 'IfMatch', condition: current._etag } } : undefined);
      return true;
    } catch (err) {
      if ((err as { code?: number })?.code !== 412) throw err;
    }
  }
  throw new Error('invite_list_contended');
}

function docsFor(groupId: string, createdBy: string, createdAt: string, expiresAt: string): { link: InviteDoc; code: InviteDoc } {
  const token = newToken();
  const linkId = inviteDocId(token);
  const link: InviteDoc = { id: linkId, kind: 'invite', groupId, pairId: linkId, secret: token, createdAt, createdBy, expiresAt };
  const code = newCode();
  return { link, code: { id: codeDocId(code), kind: 'code', groupId, pairId: linkId, secret: code, createdAt, createdBy, expiresAt } };
}

/**
 * A new one-time invite: a link and a code, live for `INVITE_TTL_MS`.
 *
 * The docs are created first and the list entry added second, so a failure
 * part-way leaves two orphan docs nothing names — unreachable, and harmless —
 * rather than a listed invite whose docs do not exist.
 */
export async function mintInvite(groupId: string, createdBy: string, now = Date.now()): Promise<GroupInvite | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return null;

  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
  const link = await createUnique(() => docsFor(groupId, createdBy, createdAt, expiresAt).link);
  let codeDoc: InviteDoc | undefined;
  await createUnique(() => {
    codeDoc = { ...docsFor(groupId, createdBy, createdAt, expiresAt).code, pairId: link.id };
    return codeDoc;
  });
  const entry: PendingInvite = { id: link.id, codeId: codeDoc!.id, createdAt, expiresAt };
  const listed = await editInvites(groupId, now, (entries) => [...entries, entry]);
  if (!listed) return null;
  return { id: link.id, token: link.secret!, code: codeDoc!.secret!, createdAt, expiresAt };
}

/** The club's live invites with their secrets, newest first — for an ADMIN. */
export async function listInvites(groupId: string, now = Date.now()): Promise<GroupInvite[]> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return [];
  const out: GroupInvite[] = [];
  // Newest first: the list is append-ordered, and two minted in the same
  // millisecond keep that order under the stable sort below.
  for (const entry of live(group.invites, now).slice().reverse()) {
    const [link, code] = await Promise.all([readInviteDoc(entry.id), readInviteDoc(entry.codeId)]);
    if (!link?.secret || !code?.secret) continue; // used, or its docs are gone
    out.push({ id: entry.id, token: link.secret, code: code.secret, createdAt: entry.createdAt, expiresAt: entry.expiresAt });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Retire one live invite. `false` when the club does not hold it. */
export async function revokeInvite(groupId: string, id: string, now = Date.now()): Promise<boolean> {
  let removed: PendingInvite | undefined;
  const ok = await editInvites(groupId, now, (entries) => {
    removed = entries.find((e) => e.id === id);
    return removed ? entries.filter((e) => e.id !== id) : null;
  });
  if (!ok || !removed) return false;
  // Housekeeping, not the revocation — the list was.
  await Promise.all([deleteDoc(removed.id), deleteDoc(removed.codeId)]);
  return true;
}

/**
 * The live list entry a secret names, with its group — or `null`.
 *
 * ONE `null` FOR EVERY FAILURE — unknown secret, wrong kind, used, expired,
 * revoked, closed group, a legacy club-wide doc. The caller must answer the
 * same way for all of them, the way `claimMigration` makes absent, expired
 * and already-used indistinguishable: a probe that can tell "wrong token" from
 * "right token, used" is an oracle for which groups and invites exist.
 */
async function locate(raw: string, kind: 'invite' | 'code', now: number): Promise<{ group: Group; entry: PendingInvite } | null> {
  const id = kind === 'invite' ? inviteDocId(raw.trim()) : codeDocId(raw);
  const doc = await readInviteDoc(id);
  if (!doc || doc.kind !== kind || !doc.pairId) return null;
  const group = await readGroup(doc.groupId);
  if (!group || group.closedAt) return null;
  // Live exactly while the group lists it — see the header.
  const entry = live(group.invites, now).find((e) => e.id === doc.pairId);
  return entry ? { group, entry } : null;
}

/** Resolve a secret to a group id without consuming it (the signed-out preview). */
export async function resolveInvite(raw: string, kind: 'invite' | 'code', now = Date.now()): Promise<string | null> {
  const found = await locate(raw, kind, now);
  return found ? found.group.id : null;
}

/**
 * Consume an invite: it leaves the club's list, atomically, and the claim
 * carries what the sign-up needs to put it back or to finish it. `null` for
 * everything `resolveInvite` refuses, and for losing the race.
 */
export async function claimInvite(raw: string, kind: 'invite' | 'code', now = Date.now()): Promise<InviteClaim | null> {
  const found = await locate(raw, kind, now);
  if (!found) return null;
  const { group, entry } = found;
  const taken = await editInvites(group.id, now, (entries) =>
    entries.some((e) => e.id === entry.id) ? entries.filter((e) => e.id !== entry.id) : null,
  );
  if (!taken) return null;
  return {
    groupId: group.id,
    async release() {
      try {
        await editInvites(group.id, now, (entries) => (entries.some((e) => e.id === entry.id) ? entries : [...entries, entry]));
      } catch (err) {
        console.error('invite release failed:', err);
      }
    },
    async finalize(usedBy, at = Date.now()) {
      const usedAt = new Date(at).toISOString();
      for (const id of [entry.id, entry.codeId]) {
        try {
          const doc = await readInviteDoc(id);
          if (!doc) continue;
          const { secret: _dropped, ...rest } = doc;
          await getContainer('groups').item(id, id).replace({ ...rest, usedAt, usedBy });
        } catch (err) {
          // Best-effort: the list entry is gone, which is what made it used.
          console.error('invite finalize failed:', err);
        }
      }
    },
  };
}
