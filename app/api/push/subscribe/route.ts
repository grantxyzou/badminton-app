import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { ensurePushContainer, hashEndpoint } from '@/lib/push';
import type { PushSubscriptionDoc } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** One member, many devices — but not unbounded. Oldest-seen is evicted rather
 *  than 409ing, so a user who cycles browsers never hits a wall they can't
 *  clear themselves. */
const MAX_DEVICES_PER_MEMBER = 10;
const MAX_ENDPOINT_LEN = 1000;

/**
 * A PushSubscription as the browser serializes it. Validated structurally
 * because it comes straight from client JSON — a malformed doc here would fail
 * at send time, far from the cause.
 */
function parseSubscription(
  body: unknown,
): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { endpoint?: unknown; keys?: unknown };

  if (typeof b.endpoint !== 'string') return null;
  const endpoint = b.endpoint.trim();
  if (!endpoint || endpoint.length > MAX_ENDPOINT_LEN) return null;
  // Push services are always https. Rejecting anything else keeps the send path
  // from being pointed at an arbitrary internal host.
  try {
    if (new URL(endpoint).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  if (!b.keys || typeof b.keys !== 'object') return null;
  const k = b.keys as { p256dh?: unknown; auth?: unknown };
  if (typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null;
  const p256dh = k.p256dh.trim();
  const auth = k.auth.trim();
  // Real values are ~87 and ~22 base64url chars. Loose bounds — enough to
  // reject empty/garbage without brittle exactness across browsers.
  if (p256dh.length < 20 || p256dh.length > 200) return null;
  if (auth.length < 10 || auth.length > 100) return null;
  if (!/^[A-Za-z0-9_-]+=*$/.test(p256dh) || !/^[A-Za-z0-9_-]+=*$/.test(auth)) return null;

  return { endpoint, keys: { p256dh, auth } };
}

/* REAL COSMOS DOES NOT AUTO-CREATE CONTAINERS; the mock store does. That gap
   is why this shipped broken with every test green: `pushSubscriptions` did not
   exist in production, so the first query threw and the opt-in sheet hung on
   "working" with nothing to show for it.

   `lib/push.ts` already owned and exported the guard for its own reads — this
   route just never called it. Reusing it rather than adding a second memo, so
   there is one owner of "does the container exist yet". */

/** Every doc for this member. The mock ignores a @memberId WHERE and returns
 *  the whole container, so we JS-filter for mock/real parity (same convention
 *  as app/api/kudos/route.ts). */
async function loadForMember(memberId: string): Promise<PushSubscriptionDoc[]> {
  await ensurePushContainer();
  const { resources } = await getContainer('pushSubscriptions')
    .items.query({ query: 'SELECT * FROM c' })
    .fetchAll();
  return (resources as PushSubscriptionDoc[]).filter((d) => d && d.memberId === memberId);
}

export async function POST(req: NextRequest) {
  // Rate limit before auth so it can't be bypassed (security rule 4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`push-sub:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Identity-bound (security rule 12): the owner is the cookie holder, never
  // the body. Member names are enumerable via GET /api/members, so a
  // body-supplied memberId would let anyone register a device against another
  // member and receive their targeted notifications.
  const member = verifyMemberAuth(req);
  if (!member) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  try {
    await ensurePushContainer();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
    }

    const parsed = parseSubscription(body);
    if (!parsed) {
      return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
    }

    const container = getContainer('pushSubscriptions');
    const endpointHash = hashEndpoint(parsed.endpoint);
    const now = new Date().toISOString();
    const mine = await loadForMember(member.memberId);
    const existing = mine.find((d) => d.endpointHash === endpointHash);

    if (existing) {
      // Same device re-subscribing (permission re-grant, key rotation on the
      // browser side). Refresh rather than duplicate.
      await container.items.upsert({
        ...existing,
        keys: parsed.keys,
        endpoint: parsed.endpoint,
        memberName: member.name,
        lastSeenAt: now,
        failureCount: 0,
      });
      return NextResponse.json({ ok: true, refreshed: true });
    }

    const ua = req.headers.get('user-agent')?.slice(0, 200) ?? undefined;
    const doc: PushSubscriptionDoc = {
      id: randomBytes(16).toString('hex'),
      memberId: member.memberId,
      memberName: member.name,
      endpoint: parsed.endpoint,
      endpointHash,
      keys: parsed.keys,
      ua,
      createdAt: now,
      lastSeenAt: now,
    };
    await container.items.create(doc);

    // Evict oldest-seen beyond the cap, so an abandoned browser doesn't hold a
    // slot forever.
    const overflow = [...mine, doc]
      .sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))
      .slice(0, Math.max(0, mine.length + 1 - MAX_DEVICES_PER_MEMBER));
    for (const stale of overflow) {
      try {
        await container.item(stale.id, stale.memberId).delete();
      } catch (err) {
        console.error('[push] failed to evict stale subscription', stale.id, err);
      }
    }

    // Never echo the subscription back — the endpoint is a send credential.
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error('POST push/subscribe error:', error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`push-unsub:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (!isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const member = verifyMemberAuth(req);
  if (!member) return NextResponse.json({ error: 'auth_required' }, { status: 401 });

  try {
    await ensurePushContainer();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
    }
    const endpoint =
      body && typeof body === 'object' && typeof (body as { endpoint?: unknown }).endpoint === 'string'
        ? (body as { endpoint: string }).endpoint.trim()
        : '';
    if (!endpoint) {
      return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
    }

    const container = getContainer('pushSubscriptions');
    const endpointHash = hashEndpoint(endpoint);
    // Scoped to THIS member's docs. Matching on endpoint alone would let anyone
    // holding an endpoint string unsubscribe someone else's device.
    const mine = await loadForMember(member.memberId);
    const targets = mine.filter((d) => d.endpointHash === endpointHash);

    for (const doc of targets) {
      await container.item(doc.id, doc.memberId).delete();
    }

    // Idempotent: removing something already gone is a success, not a 404.
    return NextResponse.json({ ok: true, removed: targets.length });
  } catch (error) {
    console.error('DELETE push/subscribe error:', error);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
}
