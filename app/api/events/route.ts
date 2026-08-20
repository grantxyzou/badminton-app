import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import type { EngagementEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';

const RATE_MAX = 120;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Allowlisted event kinds. Deliberately closed: an open `kind` field turns this
 * into a free-text sink that nothing can aggregate, and every new kind should
 * be a considered addition with a matching reader.
 */
const KINDS = ['rec_card_tap'] as const;
type Kind = (typeof KINDS)[number];

function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

// Lazy container bootstrap — real Cosmos doesn't auto-create containers (the
// mock store does, which is exactly how that difference hides until prod).
// Partitioned by `/memberId`: every read is "what did this member do", and it
// keeps one heavy user from hot-spotting a shared partition.
let ready: Promise<void> | null = null;
function ensureEvents(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('events', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
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

  if (!isKind(body.kind)) {
    return NextResponse.json({ error: 'unknown_kind' }, { status: 400 });
  }

  try {
    await ensureEvents();
    const record: EngagementEvent = {
      id: randomBytes(16).toString('hex'),
      memberId: caller.memberId,
      name: caller.name,
      kind: body.kind,
      at: new Date().toISOString(),
    };
    const { resource } = await getContainer('events').items.create(record);
    return NextResponse.json(resource, { status: 201 });
  } catch (err) {
    // A beacon must never be load-bearing, but it must also not lie about
    // having recorded something — the caller ignores this, the log doesn't.
    console.error('POST events error:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
