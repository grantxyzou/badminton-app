/**
 * GET  /api/stringing/jobs — the bench (admin) or your own jobs (player).
 * POST /api/stringing/jobs — log a racket onto the bench. Admin only.
 *
 * ONE ROUTE, TWO AUDIENCES, AND THE STRIP IS THE POINT
 * ---------------------------------------------------
 * A stringer sees `StringingJob`: the exact price, who owns the job, the bench
 * status. A player sees `PlayerStringingJob`: a price BAND, no stringer, and
 * the player vocabulary. `toPlayerJob` is the only way a job reaches a
 * non-admin, so the strip cannot be forgotten at a call site — the same shape
 * the codebase already uses for `deleteToken` and `pinHash`.
 *
 * `priceCents` is therefore a strip-canary. Any new endpoint returning a job to
 * a player must go through `toPlayerJob`; search for it before adding one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { verifyMemberAuth, isAdminAuthedWithMember } from '@/lib/auth';
import { isFlagOn } from '@/lib/flags';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import {
  isStringingStatus,
  isValidTension,
  playerStageFor,
  playerStageIndex,
  priceBand,
  formatPriceBand,
  formatJobNo,
} from '@/lib/stringing';
import type { StringingJob, PlayerStringingJob } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const READS_PER_HOUR = 120;
const WRITES_PER_HOUR = 60;
const MAX_LABEL = 80;
/** `readyBy` is a DATE. It shipped as free text, which could not be translated,
 *  could not be compared, and so made "overdue" impossible — see
 *  lib/stringingDue.ts. Validated here rather than only in the form, because
 *  the form is not the only thing that can POST. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !ISO_DATE.test(value.trim())) return undefined;
  const t = value.trim();
  return Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? undefined : t;
}

let ready: Promise<void> | null = null;
function ensureJobs(): Promise<void> {
  if (!ready) {
    // Not memoising the rejection: a container that failed to create once must
    // be retried on the next request, not remembered as permanently broken.
    ready = ensureContainer('stringingJobs', '/memberId').catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** The ONLY way a job reaches a non-admin. See the file docblock. */
export function toPlayerJob(job: StringingJob): PlayerStringingJob {
  return {
    id: job.id,
    jobNo: job.jobNo,
    stage: playerStageFor(job.status),
    stageIndex: playerStageIndex(job.status),
    racketLabel: job.racketLabel,
    stringLabel: job.stringLabel,
    tensionMains: job.tensionMains,
    tensionCrosses: job.tensionCrosses,
    method: job.method,
    // A band, never the figure. `formatPriceBand` returns null for an unpriced
    // job, which the UI renders as "Grant will confirm" rather than as free.
    priceRange: formatPriceBand(priceBand(job.priceCents)),
    readyBy: job.readyBy,
    paid: job.paidAt !== null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function trimmed(value: unknown, max = MAX_LABEL): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

export async function GET(req: NextRequest) {
  // Flag read SERVER-side: the price a stringer charges is admin-only data, and
  // a client flag cannot protect a database.
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rule 4 — rate limit before auth, so it cannot be bypassed.
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-read:${ip}`, READS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const admin = await isAdminAuthedWithMember(req);
  const caller = verifyMemberAuth(req);
  if (!admin.authed && !caller) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    await ensureJobs();
    const container = getContainer('stringingJobs');

    if (admin.authed) {
      // The bench. `?mine=true` filters to the caller's own claimed jobs —
      // the design's Mine / All segment.
      const mine = req.nextUrl.searchParams.get('mine') === 'true';
      const query = mine
        ? {
            query: 'SELECT * FROM c WHERE c.stringerId = @stringerId',
            parameters: [{ name: '@stringerId', value: admin.memberId }],
          }
        : { query: 'SELECT * FROM c', parameters: [] };
      const { resources } = await container.items.query<StringingJob>(query).fetchAll();
      const jobs = resources.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return NextResponse.json({ jobs, view: 'bench' });
    }

    // A player: their own jobs, stripped. Single-partition — the reason
    // `/memberId` is the partition key.
    const { resources } = await container.items
      .query<StringingJob>({
        query: 'SELECT * FROM c WHERE c.memberId = @memberId',
        parameters: [{ name: '@memberId', value: caller!.memberId }],
      })
      .fetchAll();
    const jobs = resources
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPlayerJob);
    return NextResponse.json({ jobs, view: 'player' });
  } catch (err) {
    // Never `catch { return [] }` — a load failure must not render as "no
    // jobs", which is the lying-empty-state rule this codebase already carries.
    console.error('GET /api/stringing/jobs failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const ip = getClientIp(req);
  if (!checkRateLimit(`stringing-write:${ip}`, WRITES_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Rule 3 — auth before body parsing. Mutating, so the role is re-read.
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const memberId = trimmed(body.memberId);
  const memberName = trimmed(body.memberName);
  const racketLabel = trimmed(body.racketLabel);
  const stringLabel = trimmed(body.stringLabel);
  if (!memberId || !memberName || !racketLabel || !stringLabel) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!isValidTension(body.tensionMains) || !isValidTension(body.tensionCrosses)) {
    return NextResponse.json({ error: 'invalid_tension' }, { status: 400 });
  }
  const priceCents =
    body.priceCents === null || body.priceCents === undefined
      ? null
      : Number.isInteger(body.priceCents) && body.priceCents >= 0 && body.priceCents <= 100000
        ? (body.priceCents as number)
        : undefined;
  if (priceCents === undefined) {
    return NextResponse.json({ error: 'invalid_price' }, { status: 400 });
  }
  const readyBy = isoDateOrNull(body.readyBy);
  if (readyBy === undefined) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }
  const status = body.status === undefined ? 'received' : body.status;
  if (!isStringingStatus(status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }

  const now = new Date().toISOString();
  try {
    await ensureJobs();
    const container = getContainer('stringingJobs');

    // Job NUMBER only — the id stays random. A sequential id would be
    // enumerable, and this number is printed on a tag anyone can read.
    const { resources: existing } = await container.items
      .query<{ n: number }>({ query: 'SELECT VALUE COUNT(1) FROM c', parameters: [] })
      .fetchAll();
    const sequence = (typeof existing[0] === 'number' ? existing[0] : 0) + 1;

    const job: StringingJob = {
      id: `job-${randomBytes(8).toString('hex')}`,
      memberId,
      jobNo: formatJobNo(sequence),
      memberName,
      // Whoever logs it claims it by default; the design's Mine filter is only
      // useful if jobs land somewhere rather than in an unclaimed pile.
      stringerId: admin.memberId ?? null,
      stringerName: admin.name ?? null,
      status,
      racketLabel,
      stringLabel,
      tensionMains: body.tensionMains,
      tensionCrosses: body.tensionCrosses,
      method: trimmed(body.method, 120) ?? 'Zach · 2 strings, 4 knots',
      priceCents,
      readyBy,
      acceptedAt: null,
      paidAt: null,
      sessionId: trimmed(body.sessionId, 60),
      createdAt: now,
      updatedAt: now,
      history: [{ status, at: now, by: admin.memberId ?? null }],
    };

    await container.items.create(job);
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    console.error('POST /api/stringing/jobs failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
