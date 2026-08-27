/**
 * POST /api/stringing/requests — a player asks for a restring.
 *
 * SEPARATE FROM THE ADMIN POST, DELIBERATELY.
 *
 * `POST /api/stringing/jobs` takes `memberId` and `memberName` from the BODY,
 * because a stringer logging a walk-up is filing on someone else's behalf.
 * That is correct there and catastrophic here: a player who could name the
 * member would be able to file requests as anybody. So this route never reads
 * an identity from the body at all — it takes it from the `member_session`
 * cookie and nothing else. Two handlers with two rules beats one handler with
 * a branch, because the branch is where the body-trust leaks.
 *
 * What a player may set is the racket, the string and the tension. What they
 * may NOT set is the price (the stringer's, and never theirs to propose), the
 * status (always `requested` — they have not handed anything over yet), the
 * stringer, or the ready-by date. Those are claims about the bench.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { isValidTension, formatJobNo } from '@/lib/stringing';
import { readShopOpen } from '@/lib/stringingShop';
import { toPlayerJob } from '../jobs/route';
import type { StringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const REQUESTS_PER_HOUR = 10;
/**
 * How many unfinished requests one player may have at once.
 *
 * Not a rate limit — that is separate and IP-keyed. This bounds the SHELF: a
 * stringer with forty open requests from one member has a mess to sort out in
 * person, and the app should not have helped create it. Three is more rackets
 * than anybody hands over at one session.
 */
const MAX_OPEN_PER_MEMBER = 3;
const OPEN_STATUSES = ['requested', 'received', 'strung', 'ready'];

let ready: Promise<void> | null = null;
function ensureJobs(): Promise<void> {
  if (!ready) {
    ready = ensureContainer('stringingJobs', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

function label(value: unknown, max = 80): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rule 4 — rate limit first, so it cannot be bypassed by an unauthorised
  // caller hammering the route.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-request:${ip}`, REQUESTS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Identity from the cookie. Never the body — see the file docblock.
  const caller = verifyMemberAuth(req);
  if (!caller) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // The shop sign is enforced HERE, not only in the UI. The Home card decides
  // whether to show the button from the same value, but a client cannot be
  // trusted to have looked.
  const open = await readShopOpen();
  if (open !== true) {
    // `null` (unknown) refuses too. A request accepted while we could not tell
    // whether anyone is stringing is a racket nobody is expecting.
    return NextResponse.json({ error: 'shop_closed' }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const racketLabel = label(body.racketLabel);
  const stringLabel = label(body.stringLabel);
  if (!racketLabel || !stringLabel) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!isValidTension(body.tensionMains) || !isValidTension(body.tensionCrosses)) {
    return NextResponse.json({ error: 'invalid_tension' }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    await ensureJobs();
    const container = getContainer('stringingJobs');

    // Single-partition read — the reason /memberId is the partition key.
    const { resources: existing } = await container.items
      .query<StringingJob>({
        query: 'SELECT * FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: caller.memberId }],
      })
      .fetchAll();
    const openCount = existing.filter((j) => OPEN_STATUSES.includes(j.status)).length;
    if (openCount >= MAX_OPEN_PER_MEMBER) {
      return NextResponse.json({ error: 'too_many_open' }, { status: 409 });
    }

    const { resources: counted } = await container.items
      .query<number>({ query: 'SELECT VALUE COUNT(1) FROM c', parameters: [] })
      .fetchAll();
    const sequence = (typeof counted[0] === 'number' ? counted[0] : 0) + 1;

    const job: StringingJob = {
      id: `job-${randomBytes(8).toString('hex')}`,
      memberId: caller.memberId,
      jobNo: formatJobNo(sequence),
      memberName: caller.name,
      // Unclaimed: a request is not yet anybody's work. The stringer takes it
      // on the bench, which is also what moves it off `requested`.
      stringerId: null,
      stringerName: null,
      status: 'requested',
      racketLabel,
      stringLabel,
      tensionMains: body.tensionMains,
      tensionCrosses: body.tensionCrosses,
      method: 'Zach · 2 strings, 4 knots',
      // The player does not propose a price and is not quoted one yet.
      priceCents: null,
      readyBy: null,
      acceptedAt: null,
      paidAt: null,
      sessionId: null,
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'requested', at: now, by: caller.memberId }],
    };

    await container.items.create(job);
    // The PLAYER view back, not the raw document. Symmetry with GET matters
    // here: a create that echoed the full job would hand back exactly the
    // fields the read is careful to strip.
    return NextResponse.json({ job: toPlayerJob(job) }, { status: 201 });
  } catch (err) {
    console.error('POST /api/stringing/requests failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
