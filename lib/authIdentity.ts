/**
 * The `identities` container: the credential layer that resolves a provider
 * identity to an existing `memberId`.
 *
 * WHY A CONTAINER AND NOT AN ARRAY ON THE MEMBER
 * ----------------------------------------------
 * Two properties earn the extra container, and an array on `Member` has
 * neither:
 *
 * 1. The OAuth callback lookup is a POINT READ. `id` is both the document id
 *    and the partition key, so `google:<sub>` -> memberId is the cheapest
 *    operation Cosmos offers, on the hottest path in the flow. An array would
 *    force a cross-partition scan of `members` on every sign-in.
 *
 * 2. `items.create()` gives ATOMIC UNIQUENESS. Cosmos has no unique constraint
 *    across partitions, so "is this email already taken?" cannot be answered by
 *    a query without a race between the check and the write. Creating the
 *    document IS the check: a duplicate id throws 409. That is why the email
 *    reservation lives here rather than as a field on the member.
 *
 * This module is the ONLY place that knows the `<provider>:<key>` encoding.
 */
import { getContainer, ensureContainer } from '@/lib/cosmos';

export type AuthProvider = 'google' | 'apple' | 'email';

export interface AuthIdentity {
  id: string;
  provider: AuthProvider;
  memberId: string;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * Lowercase + trim only. Deliberately does NOT strip dots or `+tags`: that
 * canonicalization is Gmail-specific, and applying it universally would merge
 * two genuinely different mailboxes on hosts that treat them as distinct.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function identityId(provider: AuthProvider, key: string): string {
  const normalized = provider === 'email' ? normalizeEmail(key) : key.trim();
  return `${provider}:${normalized}`;
}

// Lazy one-shot container bootstrap — real Cosmos does not auto-create
// containers the way the mock store does. Same pattern as app/api/skills.
let ensured: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!ensured) ensured = ensureContainer('identities', '/id');
  return ensured;
}

export async function lookupIdentity(
  provider: AuthProvider,
  key: string,
): Promise<AuthIdentity | null> {
  await ready();
  const id = identityId(provider, key);
  try {
    // PK path is `/id`, so the partition key VALUE is the id itself.
    const { resource } = await getContainer('identities').item(id, id).read<AuthIdentity>();
    return resource ?? null;
  } catch {
    return null;
  }
}

export async function reserveIdentity(
  provider: AuthProvider,
  key: string,
  memberId: string,
): Promise<{ ok: true; identity: AuthIdentity } | { ok: false; reason: 'taken' }> {
  await ready();
  const id = identityId(provider, key);
  const identity: AuthIdentity = {
    id,
    provider,
    memberId,
    createdAt: new Date().toISOString(),
  };
  try {
    const { resource } = await getContainer('identities').items.create(identity);
    return { ok: true, identity: (resource as AuthIdentity) ?? identity };
  } catch (err) {
    if ((err as { code?: number })?.code !== 409) throw err;
    // Already exists. Idempotent when it is the SAME member re-reserving —
    // otherwise the key belongs to someone else and must not be stolen.
    const existing = await lookupIdentity(provider, key);
    if (existing && existing.memberId === memberId) return { ok: true, identity: existing };
    return { ok: false, reason: 'taken' };
  }
}

export async function releaseIdentity(provider: AuthProvider, key: string): Promise<void> {
  await ready();
  const id = identityId(provider, key);
  try {
    await getContainer('identities').item(id, id).delete();
  } catch {
    // Already gone is the desired end state.
  }
}

/**
 * Delete an identity by its document, rather than by (provider, key).
 *
 * Callers that already hold an `AuthIdentity` should not have to take its `id`
 * apart to remove it — the `<provider>:<key>` encoding is this module's alone,
 * and a caller doing `id.slice(provider.length + 1)` is a second place that
 * knows the format and can drift from it.
 */
export async function releaseIdentityDoc(identity: AuthIdentity): Promise<void> {
  await ready();
  try {
    await getContainer('identities').item(identity.id, identity.id).delete();
  } catch {
    // Already gone is the desired end state.
  }
}

export async function listIdentitiesForMember(memberId: string): Promise<AuthIdentity[]> {
  await ready();
  const { resources } = await getContainer('identities')
    .items.query<AuthIdentity>({
      query: 'SELECT * FROM c WHERE c.memberId = @memberId',
      parameters: [{ name: '@memberId', value: memberId }],
    })
    .fetchAll();
  return resources ?? [];
}

export async function touchIdentity(provider: AuthProvider, key: string): Promise<void> {
  const existing = await lookupIdentity(provider, key);
  if (!existing) return;
  try {
    await getContainer('identities').items.upsert({
      ...existing,
      lastUsedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort telemetry; never fail a sign-in over it.
  }
}
