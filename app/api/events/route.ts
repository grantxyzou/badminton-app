import { NextRequest, NextResponse } from 'next/server';
import { writeEvent, isClientKind, isCheckInSource, isUsageKind, CLIENT_PAYLOAD, USAGE_PLATFORMS, USAGE_TABS } from '@/lib/events';
import { usageOn } from '@/lib/usage';
import { resolveGroupId } from '@/lib/groupContext';
import { verifyMemberAuth } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { EngagementEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Per IP, then per member. The IP limit is loose because a whole club can sit
// behind one gym's wifi and the usage beacons fire on every app open and tab
// change; the member limit is what stops one account flooding the container.
const RATE_MAX_IP = 600;
const RATE_MAX_MEMBER = 120;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

/**
 * The kinds and their payload schema live in `lib/events.ts`, once. Every
 * field a kind does not declare is dropped here — an open payload turns the
 * container into a free-text sink — and a server-only kind (`pick_served`,
 * the feedback loop's denominator) is not a client kind at all, so it is
 * refused as unknown.
 */
type Payload = Pick<EngagementEvent, 'catalogId' | 'engineVersion' | 'rating' | 'category' | 'source' | 'tab' | 'platform'>;

function payloadFor(kind: keyof typeof CLIENT_PAYLOAD, body: Record<string, unknown>): Payload {
  const out: Payload = {};
  for (const field of CLIENT_PAYLOAD[kind]) {
    if (field === 'catalogId' && typeof body.catalogId === 'string' && body.catalogId.length <= 80) out.catalogId = body.catalogId;
    if (field === 'engineVersion' && typeof body.engineVersion === 'string' && body.engineVersion.length <= 20) out.engineVersion = body.engineVersion;
    if (field === 'rating' && (body.rating === 'up' || body.rating === 'down')) out.rating = body.rating;
    if (field === 'category' && (body.category === 'racket' || body.category === 'string')) out.category = body.category;
    if (field === 'source' && isCheckInSource(body.source)) out.source = body.source;
    if (field === 'tab' && oneOf(USAGE_TABS, body.tab)) out.tab = body.tab;
    if (field === 'platform' && oneOf(USAGE_PLATFORMS, body.platform)) out.platform = body.platform;
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
  if (!checkRateLimit(`events:${ip}`, RATE_MAX_IP, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
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
  if (!checkRateLimit(`events-member:${caller.memberId}`, RATE_MAX_MEMBER, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!isClientKind(body.kind)) {
    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 });
  }

  // The flag gate is PER-KIND, and deliberately below the kind parse rather
  // than at the top of the handler.
  //
  // Equipment kinds keep the /api/games posture: the feature's flag gates its
  // API surface too, so turning the flag off doesn't leave a live write
  // endpoint behind. The SKILL-funnel kinds do not, because this gate used to
  // be a blanket 404 on a flag with a retirement date on it — every beacon in
  // the app would have gone silent on the day that flag was deleted, and a
  // measurement that switches itself off on a date is not a measurement.
  //
  // Order is load-bearing: rate limit (rule 4) and auth (rule 12) both still
  // run FIRST. Hoisting the kind parse above them to decide the gate earlier
  // would put body parsing in front of authentication.
  //
  // The usage kinds (app_open, tab_view) are the one gated family today:
  // nothing about how members use the app is recorded until the privacy
  // labels say so (docs/plans/usage-metrics.md).
  if (isUsageKind(body.kind) && !usageOn()) {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }
  try {
    const resource = await writeEvent(
      {
        memberId: caller.memberId,
        name: caller.name,
        kind: body.kind,
        ...payloadFor(body.kind, body),
      },
      resolveGroupId(req),
    );
    return NextResponse.json(resource, { status: 201 });
  } catch (err) {
    // A beacon must never be load-bearing, but it must also not lie about
    // having recorded something — the caller ignores this, the log doesn't.
    console.error('POST events error:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
