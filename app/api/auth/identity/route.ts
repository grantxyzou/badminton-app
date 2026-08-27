/**
 * DELETE /api/auth/identity — disconnect a linked provider from the caller's
 * own account.
 *
 * THE LAST-CREDENTIAL RULE
 * ------------------------
 * A member must always keep at least one way back in: a PIN, a password, or
 * another linked provider. Removing the final one is a self-inflicted lockout
 * whose only recovery is an admin-issued code — and the person tapping
 * "Disconnect" has no way to know that at the moment they tap it. So the server
 * refuses, and the UI explains why rather than offering an action that bricks
 * the account.
 *
 * Identity comes from the `member_session` cookie. There is deliberately no
 * `memberId` parameter: a name- or id-keyed version would let anyone strip
 * anyone else's sign-in methods, which is both a denial of service and a way to
 * force a target onto a weaker credential.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyMemberAuth } from '@/lib/auth';
import { listIdentitiesForMember, releaseIdentityDoc } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROVIDERS = new Set(['google', 'apple']);

export async function DELETE(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-unlink:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const auth = verifyMemberAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { provider?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const provider = typeof body.provider === 'string' ? body.provider : '';
  if (!PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    const container = getContainer('members');
    const { resource: member } = await container
      .item(auth.memberId, auth.memberId)
      .read<Member>();
    if (!member || member.active !== true) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // `identities` is the source of truth, not `member.linkedProviders` — that
    // field is display-only and can drift.
    const identities = await listIdentitiesForMember(member.id);
    const target = identities.find((i) => i.provider === provider);
    if (!target) return NextResponse.json({ error: 'not_linked' }, { status: 404 });

    const hasPin = typeof member.pinHash === 'string' && member.pinHash.length > 0;
    const hasPassword = typeof member.passwordHash === 'string' && member.passwordHash.length > 0;
    const otherProviders = identities.filter(
      (i) => i.provider !== 'email' && i.id !== target.id,
    ).length;

    if (!hasPin && !hasPassword && otherProviders === 0) {
      return NextResponse.json({ error: 'last_credential' }, { status: 409 });
    }

    // Order matters: drop the identity doc first. If the member upsert then
    // fails, the worst case is a stale `linkedProviders` entry — cosmetic, and
    // self-corrects on the next read, since the container is authoritative.
    // The reverse order could leave a live identity the UI says is gone.
    await releaseIdentityDoc(target);

    const remaining = (member.linkedProviders ?? []).filter((p) => p !== provider);
    await container.items.upsert({ ...member, linkedProviders: remaining });

    return NextResponse.json({ ok: true, linked: remaining });
  } catch (err) {
    console.error('DELETE /api/auth/identity unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
