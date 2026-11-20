import { getContainer } from '@/lib/cosmos';
import { reserveIdentity, normalizeEmail } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';
import type { PendingLink } from '@/lib/accessRequest';

export type LinkOutcome = { ok: true; member: Member } | { ok: false; reason: 'already_linked' | 'gone' };

/**
 * Join a new sign-in — Apple, Google or an email code — to an EXISTING member
 * who has proved it is them ("Is that you?", docs/plans/sign-in-redesign.md).
 * The one place it is done: `auth/claim-name` after a PIN, and an approval
 * from the person's own phone or an organizer (step 3).
 *
 * The member is read first (nothing is reserved for an account that is gone),
 * then the provider identity is reserved for THEM; a 409 means it already
 * belongs to someone else, and it is never stolen.
 *
 * THE PERSON'S OWN ADDRESS IS NEVER TOUCHED (security review, 2026-11-20).
 * The new sign-in's address becomes the account's only when the account has
 * none, and an address it has is never released. An approval comes from a
 * tap on a phone or an organizer's card, and a mistaken one used to swap the
 * account's address for a stranger's: every email sign-in (code, password,
 * reset) then reached the stranger, and the real address no longer reached
 * the account. If another member holds the new address, it stays theirs.
 *
 * The member is re-read and written under `IfMatch`, so an access request or
 * a PIN count landing at the same moment is not overwritten.
 */
export async function linkSignInTo(memberId: string, link: PendingLink): Promise<LinkOutcome> {
  const container = getContainer('members');
  const { resource: first } = await container.item(memberId, memberId).read<Member>();
  if (!first) return { ok: false, reason: 'gone' };

  const reserved = await reserveIdentity(link.provider, link.sub, memberId);
  if (!reserved.ok) return { ok: false, reason: 'already_linked' };

  let emailDone = false;
  let claimedEmail: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return { ok: false, reason: 'gone' };

    const hasAddress = typeof resource.email === 'string' && resource.email.trim().length > 0;
    if (!emailDone && !hasAddress && link.email && link.emailVerified) {
      emailDone = true;
      const email = normalizeEmail(link.email);
      // An email-code sign-in IS this address, reserved just above.
      const emailReserved = link.provider === 'email' ? { ok: true } : await reserveIdentity('email', email, memberId);
      if (emailReserved.ok) claimedEmail = email;
    }

    // An email-proven identity is the address itself; only Google and Apple
    // are "linked providers".
    const providers = new Set([...(resource.linkedProviders ?? []), ...(link.provider === 'email' ? [] : [link.provider])]);
    const updated: Member = {
      ...resource,
      linkedProviders: [...providers],
      ...(claimedEmail ? { email: claimedEmail, emailVerified: true, mailboxProven: true } : {}),
    };
    try {
      if (typeof resource._etag === 'string') {
        await container.item(memberId, memberId).replace(updated, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      } else {
        await container.items.upsert(updated);
      }
      return { ok: true, member: updated };
    } catch (err) {
      if ((err as { code?: number }).code === 412) continue;
      throw err;
    }
  }
  throw new Error('linking a sign-in kept conflicting');
}
