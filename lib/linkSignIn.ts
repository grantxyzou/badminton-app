import { getContainer } from '@/lib/cosmos';
import { reserveIdentity, releaseIdentity, lookupIdentity, listIdentitiesForMember, normalizeEmail } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';
import type { PendingLink } from '@/lib/accessRequest';

export type LinkOutcome = { ok: true; member: Member; addedEmail: string | null } | { ok: false; reason: 'already_linked' | 'gone' };

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
  // Only an address this link RESERVED is recorded as added, so an undo can
  // never release one that was already the person's (third review).
  let addedByUs = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return { ok: false, reason: 'gone' };

    // Decided on EVERY attempt: an address set between two attempts wins.
    const hasAddress = typeof resource.email === 'string' && resource.email.trim().length > 0;
    if (hasAddress) {
      // An address set since the last attempt wins; one this link reserved
      // on that attempt is released, so nothing unrecorded stays theirs.
      if (claimedEmail && addedByUs && link.provider !== 'email') await releaseIdentity('email', claimedEmail);
      claimedEmail = null;
      addedByUs = false;
    }
    else if (!emailDone && link.email && link.emailVerified) {
      emailDone = true;
      const email = normalizeEmail(link.email);
      // An email-code sign-in IS this address, reserved just above.
      if (link.provider === 'email') {
        claimedEmail = email;
        addedByUs = reserved.created;
      } else {
        const emailReserved = await reserveIdentity('email', email, memberId);
        if (emailReserved.ok) {
          claimedEmail = email;
          addedByUs = emailReserved.created;
        }
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
      return { ok: true, member: updated, addedEmail: claimedEmail && addedByUs ? claimedEmail : null };
    } catch (err) {
      if ((err as { code?: number }).code === 412) continue;
      throw err;
    }
  }
  throw new Error('linking a sign-in kept conflicting');
}

/**
 * Take back a sign-in an approval joined to someone: the organizer approve
 * route calls it when the ask vanished while it was linking (a decline by
 * another admin, the asker re-asking, expiry), so nothing stays linked under
 * an approval that did not stand. Releases the provider identity (only if it is still theirs),
 * the address the approval added (`addedEmail`, only if the account had
 * none), and drops the provider from `linkedProviders` when no other sign-in
 * of that kind is left. Never touches anything that was theirs before.
 */
export async function unlinkSignIn(memberId: string, link: PendingLink, addedEmail?: string | null): Promise<void> {
  if ((await lookupIdentity(link.provider, link.sub))?.memberId === memberId) {
    await releaseIdentity(link.provider, link.sub);
  }
  const added = addedEmail ? normalizeEmail(addedEmail) : null;
  if (added && link.provider !== 'email' && (await lookupIdentity('email', added))?.memberId === memberId) {
    await releaseIdentity('email', added);
  }
  const left = await listIdentitiesForMember(memberId);
  const container = getContainer('members');
  for (let attempt = 0; attempt < 5; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return;
    const next: Member = { ...resource };
    if (link.provider !== 'email' && !left.some((i) => i.provider === link.provider)) {
      next.linkedProviders = (resource.linkedProviders ?? []).filter((p) => p !== link.provider);
    }
    if (added && typeof resource.email === 'string' && normalizeEmail(resource.email) === added) {
      delete next.email;
      delete next.emailVerified;
      delete next.mailboxProven;
    }
    try {
      if (typeof resource._etag === 'string') {
        await container.item(memberId, memberId).replace(next, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      } else {
        await container.items.upsert(next);
      }
      return;
    } catch (err) {
      if ((err as { code?: number }).code === 412) continue;
      throw err;
    }
  }
}
