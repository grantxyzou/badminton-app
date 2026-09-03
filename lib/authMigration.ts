/**
 * Carrying a signed-in identity from the PWA into the NATIVE shell.
 *
 * THE PROBLEM
 * -----------
 * The store build's WebView is a fresh storage container: no `member_session`
 * cookie, no `badminton_identity` in localStorage. Everyone opens the new app
 * signed out, and an anonymous sign-up loses the `deleteToken` that proves
 * they own their spot — `DELETE /api/players` accepts admin or `deleteToken`,
 * never `member_session`. A one-time link fixes both at once.
 *
 * THE SHAPE — and the DIRECTION INVERSION from lib/authHandoff.ts
 * ---------------------------------------------------------------
 * The OAuth handoff hashes its secret because the preimage never leaves the
 * device; only the hash travels. Here the secret MUST travel — it is the link
 * — so whatever is in the link IS a bearer credential and hashing it buys
 * nothing. What contains it instead:
 *
 *   - minting requires a live `member_session`, so a code can be stolen in
 *     flight but never forged;
 *   - TTL FIVE MINUTES (a link is tapped within seconds, a code typed within
 *     a minute);
 *   - single use: the docs are deleted BEFORE the member is returned;
 *   - the routes rate-limit per IP, which for the 6-digit code is the whole
 *     defence (10^6 space, 5-minute window, 10 tries an hour).
 *
 * TWO CODES, ONE MINT. The link carries a 32-hex code for the universal-link
 * path. Beside it a 6-digit short code exists for the person who tapped the
 * link before installing (Safari history would otherwise hold a bearer
 * credential) and for anyone whose universal-link resolution misfires — which
 * it will. Both are stored ONLY as hashes, as sibling docs that delete
 * together, so redeeming one burns the other.
 *
 * POINT READS ONLY. Every lookup is `item(id, id).read()` — no query — so the
 * mock store's parameter-name hazard (an unrecognised name means NO filter)
 * cannot bite a path that ends in a delete.
 */
import { createHash, randomBytes, randomInt } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';

const CONTAINER = 'authmigration';
export const MIGRATION_TTL_MS = 5 * 60 * 1000;

let ready: Promise<void> | null = null;
function containerReady(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('authmigration', '/id').catch((err) => {
      ready = null; // let the next request retry rather than cache a failure
      throw err;
    });
  }
  return ready;
}

export interface MigrationDoc {
  /** sha256 of the code (link) or of `short:<name>:<digits>` — never the code. */
  id: string;
  kind: 'link' | 'short';
  memberId: string;
  /** Display name at mint time, for the short-code namespace and the claim response. */
  name: string;
  /** The other half's id, so a claim of either deletes both. */
  sibling: string;
  /** NEXT_LOCALE at mint time, so the native app opens in the same language. */
  locale?: string;
  createdAt: string;
  expiresAt: string;
}

/** A link code is 32 random bytes as hex; reject anything else before the store. */
export function isLinkCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function isShortCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9]{6}$/.test(value);
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Short codes are namespaced by name so two members' codes cannot collide. */
function shortId(name: string, digits: string): string {
  return sha256(`short:${name.trim().toLowerCase()}:${digits}`);
}

function live(doc: MigrationDoc | null, now: number): doc is MigrationDoc {
  return !!doc && Date.parse(doc.expiresAt) > now;
}

async function readDoc(id: string): Promise<MigrationDoc | null> {
  try {
    const { resource } = await getContainer(CONTAINER).item(id, id).read<MigrationDoc>();
    return resource ?? null;
  } catch {
    return null;
  }
}

export interface Minted {
  /** Goes in the link. A bearer credential until claimed or expired. */
  linkCode: string;
  /** Six digits, typed by hand. Same lifetime, same single use. */
  shortCode: string;
  expiresAt: string;
}

/**
 * Mint a link + short-code pair for a member. The caller has ALREADY proven
 * the member (a live `member_session`); nothing here re-checks it.
 */
export async function mintMigration(
  member: { id: string; name: string },
  locale: string | undefined,
  now: number = Date.now(),
): Promise<Minted> {
  await containerReady();
  const linkCode = randomBytes(32).toString('hex');
  const shortCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const linkId = sha256(linkCode);
  const sId = shortId(member.name, shortCode);
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + MIGRATION_TTL_MS).toISOString();
  const base = { memberId: member.id, name: member.name, ...(locale ? { locale } : {}), createdAt, expiresAt };

  const container = getContainer(CONTAINER);
  await container.items.upsert({ ...base, id: linkId, kind: 'link', sibling: sId } satisfies MigrationDoc);
  await container.items.upsert({ ...base, id: sId, kind: 'short', sibling: linkId } satisfies MigrationDoc);
  return { linkCode, shortCode, expiresAt };
}

export type MigrationClaim =
  | { status: 'ready'; memberId: string; name: string; locale?: string }
  /** Absent, expired and already-used are ONE answer — a probe learns nothing. */
  | { status: 'none' };

export type ClaimInput = { link: string } | { name: string; short: string };

/**
 * Redeem a link code or a (name, short code) pair. SINGLE USE: both sibling
 * docs are deleted before the member is returned, so a replay of either finds
 * nothing.
 */
export async function claimMigration(
  input: ClaimInput,
  now: number = Date.now(),
): Promise<MigrationClaim> {
  const id =
    'link' in input
      ? isLinkCode(input.link) ? sha256(input.link) : null
      : isShortCode(input.short) && input.name.trim() ? shortId(input.name, input.short) : null;
  if (!id) return { status: 'none' };

  await containerReady();
  const doc = await readDoc(id);
  if (!live(doc, now)) return { status: 'none' };

  // Delete FIRST — both halves. If the delete fails we must not hand out the
  // session, or a replay could redeem the same stash twice.
  const container = getContainer(CONTAINER);
  try {
    await container.item(doc.id, doc.id).delete();
  } catch {
    return { status: 'none' };
  }
  try {
    await container.item(doc.sibling, doc.sibling).delete();
  } catch {
    /* the sibling may already be gone; the claimed half is what matters */
  }

  return { status: 'ready', memberId: doc.memberId, name: doc.name, ...(doc.locale ? { locale: doc.locale } : {}) };
}
