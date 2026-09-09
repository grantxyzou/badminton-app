import { NextRequest, NextResponse } from 'next/server';
import { writeEvent, isClientKind, CLIENT_PAYLOAD } from '@/lib/events';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { EngagementEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const RATE_MAX = 120;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The kinds and their payload schema live in `lib/events.ts`, once. Every
 * field a kind does not declare is dropped here — an open payload turns the
 * container into a free-text sink — and a server-only kind (`pick_served`,
 * the feedback loop's denominator) is not a client kind at all, so it is
 * refused as unknown.
 */
function payloadFor(kind: keyof typeof CLIENT_PAYLOAD, body: Record<string, unknown>): Pick<EngagementEvent, 'catalogId' | 'engineVersion' | 'rating' | 'category'> {
  const out: Pick<EngagementEvent, 'catalogId' | 'engineVersion' | 'rating' | 'category'> = {};
  for (const field of CLIENT_PAYLOAD[kind]) {
    if (field === 'catalogId' && typeof body.catalogId === 'string' && body.catalogId.length <= 80) out.catalogId = body.catalogId;
    if (field === 'engineVersion' && typeof body.engineVersion === 'string' && body.engineVersion.length <= 20) out.engineVersion = body.engineVersion;
    if (field === 'rating' && (body.rating === 'up' || body.rating === 'down')) out.rating = body.rating;
    if (field === 'category' && (body.category === 'racket' || body.category === 'string')) out.category = body.category;
  }
  return out;
}

/**
 * Records one engagement event.
 *
 * This exists because the Value-Hub Slice-0 kill-criterion is written as "≥40%
 * of dogfooders interact with the rec card MORE THAN ONCE", and nothing in the
 * app recorded interactions of any kind — there is no analytics anywhere in the
 * repo. Without per-event rows that half of the criterion is unanswerable.
 *
 * Deliberately per-event `items.create`, never an upsert: "more than once"
 * needs the history. The `insights` container upserts and keeps only the latest
 * `generatedAt`, which is precisely why it can't answer this question.
 */
export async function POST(req: NextRequest) {
  // Rate limit BEFORE auth (security rule 4) so the limit can't be bypassed by
  // an unauthenticated flood. Generous: this is a UI beacon, and a curious
  // friend tapping a card repeatedly is the behaviour we're trying to measure,
  // not abuse.
  const ip = getClientIp(req);
  if (!checkRateLimit(`events:${ip}`, RATE_MAX, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Same posture as /api/games: the feature's flag gates its API surface too, so
  // turning the flag off doesn't leave a live write endpoint behind.
  if (!isFlagOn('NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Identity-bound (security rule 12): the member_session cookie, minted at
  // sign-up without a PIN. No admin-on-behalf branch on purpose — an admin
  // tapping while browsing someone else's stats is not that member's
  // engagement. Anonymous and preview-name viewers (the Stats tab falls back
  // to `badminton_stats_preview_name` — see SkillsTab's `resolveActiveName`)
  // hold no cookie, so their taps are correctly uncounted; the client treats
  // the 401 as a no-op.
  const caller = verifyMemberAuth(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!isClientKind(body.kind)) {
    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 });
  }

  try {
    const resource = await writeEvent({
      memberId: caller.memberId,
      name: caller.name,
      kind: body.kind,
      ...payloadFor(body.kind, body),
    });
    return NextResponse.json(resource, { status: 201 });
  } catch (err) {
    // A beacon must never be load-bearing, but it must also not lie about
    // having recorded something — the caller ignores this, the log doesn't.
    console.error('POST events error:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
