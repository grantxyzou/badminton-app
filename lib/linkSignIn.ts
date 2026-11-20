import { getContainer } from '@/lib/cosmos';
import { reserveIdentity, releaseIdentity, normalizeEmail } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';
import type { PendingLink } from '@/lib/accessRequest';

export type LinkOutcome = { ok: true; member: Member } | { ok: false; reason: 'already_linked' | 'gone' };

/**
 * Join a new sign-in — Apple, Google or an email code — to an EXISTING member
 * who has proved it is them ("Is that you?", docs/plans/sign-in-redesign.md).
 * The one place it is done: `auth/claim-name` after a PIN, and an approval
 * from the person's own phone or an organizer (step 3).
 *
 * The provider identity is reserved for THIS member first; a 409 means it
 * already belongs to someone else, and it is never stolen. The address is
 * claimed best-effort: if another member already holds it the link still
 * stands (the provider identity is what signs them in) and the address stays
 * with whoever reserved it first. A previous address is released, or the old
 * one would keep resolving to this account for password sign-in and the OAuth
 * linker, and stay blocked for whoever really owns it.
 *
 * The member is re-read and written under `IfMatch`, so an access request or
 * a PIN count landing at the same moment is not overwritten.
 */
export async function linkSignInTo(memberId: string, link: PendingLink): Promise<LinkOutcome> {
  const reserved = await reserveIdentity(link.provider, link.sub, memberId);
  if (!reserved.ok) return { ok: false, reason: 'already_linked' };

  const container = getContainer('members');
  let emailDone = false;
  let claimedEmail: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return { ok: false, reason: 'gone' };

    if (!emailDone && link.email && link.emailVerified) {
      emailDone = true;
      const email = normalizeEmail(link.email);
      // An email-code sign-in IS this address, reserved just above.
      const emailReserved = link.provider === 'email' ? { ok: true } : await reserveIdentity('email', email, memberId);
      if (emailReserved.ok) {
        claimedEmail = email;
        const previous = typeof resource.email === 'string' ? normalizeEmail(resource.email) : null;
        if (previous && previous !== email) await releaseIdentity('email', previous);
      }
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
