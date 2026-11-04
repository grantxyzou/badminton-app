/**
 * The club's CLAIM LINK (docs/plans/claim-your-name.md) — how a person the
 * organiser imported onto the roster gets in.
 *
 * One reusable link per club, no expiry. It grants nothing on its own: a
 * person who opens it can only ASK to be let in under a name that is on this
 * roster and has never been signed into, and an organiser still approves each
 * ask one at a time. That is what makes it safe to post in the club chat.
 *
 * Same storage as one-time invites (lib/invites.ts): a sibling doc of the
 * `Group` in the GLOBAL `groups` container, keyed by the hash of the secret
 * (`claimlink:${sha256(token)}`), so "which club is this for?" is a point
 * read. THE CLUB RECORD IS THE AUTHORITY: `Group.claimLinkId` names the live
 * link, and a link resolves only while the club still names it — so "New
 * link" is one write, and an old link is dead the moment it lands. The
 * plaintext sits on the link doc so the organiser can copy it again tomorrow;
 * the `Group` holds only the id, so a route that returns a group verbatim
 * cannot leak a working link.
 *
 * POINT READS ONLY. No query in this file.
 */
import { createHash, randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { readGroup, setClaimLinkId } from '@/lib/groups';
import type { Member } from '@/lib/types';

/** 16 bytes of hex: not guessable; the preview's rate limit is belt and braces. */
const TOKEN_BYTES = 16;

export interface ClaimLinkDoc {
  /** `claimlink:${sha256(token)}`. */
  id: string;
  kind: 'claimlink';
  groupId: string;
  /** The plaintext — see the header. */
  secret: string;
  createdAt: string;
  createdBy: string;
}

export interface ClaimLink {
  token: string;
  createdAt: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function claimLinkDocId(token: string): string {
  return `claimlink:${sha256(token.trim())}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 404;
}

async function readDoc(id: string): Promise<ClaimLinkDoc | undefined> {
  try {
    const { resource } = await getContainer('groups').item(id, id).read();
    const doc = resource as ClaimLinkDoc | undefined;
    // The container holds groups, invites and leak records too: only a doc of
    // this kind is a claim link.
    return doc && doc.kind === 'claimlink' ? doc : undefined;
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

/** The club's live link, for an organiser to copy — or `null` when it has none. */
export async function readClaimLink(groupId: string): Promise<ClaimLink | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt || !group.claimLinkId) return null;
  const doc = await readDoc(group.claimLinkId);
  return doc && doc.groupId === groupId ? { token: doc.secret, createdAt: doc.createdAt } : null;
}

/**
 * A new link for the club, retiring the old one. The doc is created first and
 * the club pointed at it second, so a failure part-way leaves an orphan doc
 * nothing names (unreachable, harmless) rather than a club naming a link that
 * does not exist. `items.create`, never `upsert`: a hash collision must fail,
 * not overwrite another club's link.
 */
export async function rotateClaimLink(groupId: string, createdBy: string, now = Date.now()): Promise<ClaimLink | null> {
  const group = await readGroup(groupId);
  if (!group || group.closedAt) return null;
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const doc: ClaimLinkDoc = {
    id: claimLinkDocId(token),
    kind: 'claimlink',
    groupId,
    secret: token,
    createdAt: new Date(now).toISOString(),
    createdBy,
  };
  await getContainer('groups').items.create(doc);
  const updated = await setClaimLinkId(groupId, doc.id);
  if (!updated) {
    await deleteDoc(doc.id);
    return null;
  }
  // Housekeeping, not the retirement — the pointer was.
  if (group.claimLinkId && group.claimLinkId !== doc.id) await deleteDoc(group.claimLinkId);
  return { token, createdAt: doc.createdAt };
}

/**
 * The club a link is for, or `null` — ONE `null` for every failure (unknown,
 * retired, closed club, malformed), so a caller cannot answer differently and
 * turn the link into an oracle for which clubs exist.
 */
export async function resolveClaimLink(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const doc = await readDoc(claimLinkDocId(token));
  if (!doc) return null;
  const group = await readGroup(doc.groupId);
  if (!group || group.closedAt || group.claimLinkId !== doc.id) return null;
  return group.id;
}

/**
 * A name nobody has signed into yet: no PIN, no password, no Google or Apple.
 * Only such a name can be asked for with the link (Grant, 2026-11-04: Q2) —
 * someone with a credential of their own recovers through the organiser's
 * recovery code, never through a link the whole chat holds.
 */
export function isUnclaimed(member: Pick<Member, 'pinHash' | 'passwordHash' | 'linkedProviders'>): boolean {
  return !member.pinHash && !member.passwordHash && !(member.linkedProviders && member.linkedProviders.length > 0);
}
