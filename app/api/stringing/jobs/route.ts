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
import { isBillable } from '@/lib/stringingBilling';
import type { StringingJob, PlayerStringingJob, PlayerPendingEdit, StringerJob } from '@/lib/types';

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

/**
 * Archived means "off the bench", and it is checked in TWO places on purpose.
 *
 * The SQL predicate keeps real Cosmos from shipping rows nobody will render.
 * The JS check is the one that actually works everywhere: the mock store does
 * not parse SQL at all — it applies one filter per PARAMETER NAME it
 * recognises and ignores the WHERE clause — so a parameterless predicate like
 * `NOT IS_DEFINED(c.archivedAt)` matches every row in the container under test
 * while looking correct in production. Belt and braces, and the braces are the
 * JS.
 */
export function isArchived(job: Pick<StringingJob, 'archivedAt'>): boolean {
  return typeof job.archivedAt === 'string' && job.archivedAt.length > 0;
}

const LIVE_SQL = '(NOT IS_DEFINED(c.archivedAt) OR c.archivedAt = null)';
/**
 * `NOT IS_NULL(...)`, never `!= null`.
 *
 * Cosmos evaluates a comparison between two different JSON types to Undefined,
 * and a WHERE clause excludes Undefined rows — so `c.archivedAt != null` on a
 * String compares String-vs-Null, yields Undefined, and matches ZERO archived
 * jobs in production. It looked correct and passed every test, because the mock
 * store ignores the WHERE clause entirely and this predicate binds no parameter
 * for it to recognise. The JS re-check below cannot save it either: that guards
 * against too MANY rows coming back, not too few.
 *
 * `LIVE_SQL` above is fine for the same reason stated in reverse — its
 * `c.archivedAt = null` is a Null-vs-Null comparison on the only rows where it
 * is reached, which is well-defined.
 */
const ARCHIVED_SQL = '(IS_DEFINED(c.archivedAt) AND NOT IS_NULL(c.archivedAt))';

/**
 * Bench order: pinned first (most recently pinned wins), then newest.
 *
 * Sorted in JS, NOT with `ORDER BY c.prioritizedAt`. Cosmos omits documents
 * that lack the ordered field rather than sorting them last, so an ORDER BY
 * here would silently hide every job nobody had pinned — which is most of them,
 * and which would look like a data-loss bug rather than a sort bug. The route
 * already sorted in JS before this; this only adds a key.
 */
export function benchOrder(a: StringingJob, b: StringingJob): number {
  const ap = a.prioritizedAt ?? '';
  const bp = b.prioritizedAt ?? '';
  if (ap !== bp) return bp.localeCompare(ap);
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * The proposed-change diff a player is shown, or null.
 *
 * THE PRICE WALL'S ONE DOCUMENTED EXCEPTION. Both figures are exact dollars,
 * because you cannot ask somebody to agree to "$28–32" — the whole point of
 * asking is that they know the number. It is narrow by construction: nothing is
 * emitted unless a proposal is outstanding, and each field appears only if that
 * field is actually changing. Every other path still gets the band.
 *
 * Note what is NOT here: `proposedBy`. A player is told the club changed
 * something, not which volunteer typed it.
 */
export function toPlayerPendingEdit(job: StringingJob): PlayerPendingEdit | null {
  const p = job.pendingEdit;
  if (!p) return null;
  const out: PlayerPendingEdit = { proposedAt: p.proposedAt };
  if (p.racketLabel !== undefined) {
    out.racketFrom = job.racketLabel;
    out.racketTo = p.racketLabel;
  }
  if (p.stringLabel !== undefined) {
    out.stringFrom = job.stringLabel;
    out.stringTo = p.stringLabel;
  }
  if (p.tensionMains !== undefined || p.tensionCrosses !== undefined) {
    out.tensionFrom = `${job.tensionMains}/${job.tensionCrosses}`;
    out.tensionTo = `${p.tensionMains ?? job.tensionMains}/${p.tensionCrosses ?? job.tensionCrosses}`;
  }
  if (p.priceCents !== undefined) {
    out.priceFrom = job.priceCents === null ? null : job.priceCents / 100;
    out.priceTo = p.priceCents === null ? null : p.priceCents / 100;
  }
  return out;
}

/**
 * What a STRINGER sees of a job assigned to them.
 *
 * A third projection, and it exists because the two that came before answer
 * different questions. The bench view is "everything, you own this club"; the
 * player view is "your racket, and a price band". A stringer needs the SPEC —
 * what to put on, at what tension, for whom — and none of the money. What the
 * club charges is not their business, and `priceCents` stays a strip-canary
 * for them exactly as it is for a player.
 *
 * Note what IS here that a player never gets: `status`, the bench vocabulary.
 * They are working the bench, so they get its words.
 */
export function toStringerJob(job: StringingJob): StringerJob {
  return {
    id: job.id,
    jobNo: job.jobNo,
    memberId: job.memberId,
    memberName: job.memberName,
    status: job.status,
    racketLabel: job.racketLabel,
    stringLabel: job.stringLabel,
    tensionMains: job.tensionMains,
    tensionCrosses: job.tensionCrosses,
    method: job.method,
    readyBy: job.readyBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
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
    /**
     * The EXACT amount, but only once the job is billable.
     *
     * Not a hole in the price wall — the end of it. The band hides a
     * PROVISIONAL figure; once the racket is finished and priced, the player
     * has a bill, and a bill is a number. Sending it here is also what stops
     * the app contradicting itself: without this the Home card showed
     * "$28–32" directly above a balance line reading "$30" for the same
     * racket, which is the sort of thing that makes someone distrust both.
     */
    amountDue: isBillable(job) ? Math.round(job.priceCents!) / 100 : null,
    readyBy: job.readyBy,
    paid: job.paidAt !== null,
    pendingEdit: toPlayerPendingEdit(job),
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

    /**
     * `?view=player` forces the PLAYER projection for anybody, including an
     * admin.
     *
     * Without it this route branched on the caller's role alone, so a stringer
     * looking at their OWN Home card received the bench view — every member's
     * jobs, shaped with `status` instead of `stage`. The card then crashed on a
     * missing translation key, which is the loud version of the bug; the quiet
     * version was an admin's Home card showing somebody else's racket.
     *
     * An admin is also a player. Which VIEW you want is a property of the
     * screen you are on, not of who you are, so the screen says.
     */
    const asPlayer = req.nextUrl.searchParams.get('view') === 'player';

    /**
     * `?view=stringer` — the jobs assigned to the caller, for the person doing
     * the work. Gated on `canString` AND on assignment, so it can only ever
     * return their own queue; a member without the flag gets an empty list
     * rather than an error, because "you are not a stringer" is not a secret
     * worth a distinct status but is also not something to explain here.
     */
    if (req.nextUrl.searchParams.get('view') === 'stringer') {
      const me = caller?.memberId ?? (admin.authed ? admin.memberId : null);
      if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

      const canString = await getContainer('members')
        .item(me, me)
        .read<{ canString?: boolean }>()
        .then((r) => r.resource?.canString === true)
        .catch(() => false);
      if (!canString) return NextResponse.json({ jobs: [], view: 'stringer' });

      const { resources } = await container.items
        .query<StringingJob>({
          query: `SELECT * FROM c WHERE c.stringerId = @stringerId AND ${LIVE_SQL}`,
          parameters: [{ name: '@stringerId', value: me }],
        })
        .fetchAll();
      // Re-filtered: the mock recognises @stringerId but not the archive
      // predicate, and an archived job is off the bench for everyone.
      const jobs = resources
        .filter((j) => j.stringerId === me && !isArchived(j))
        .sort(benchOrder)
        .map(toStringerJob);
      return NextResponse.json({ jobs, view: 'stringer' });
    }

    if (admin.authed && !asPlayer) {
      // The bench. `?mine=true` filters to the caller's own claimed jobs —
      // the design's Mine / All segment.
      const mine = req.nextUrl.searchParams.get('mine') === 'true';
      /**
       * `?archived=true` returns ONLY archived jobs — an inclusion, not a
       * merge, because the archive is its own screen. Admin-only, and safe to
       * gate on `admin.authed` alone: this whole branch is already behind it.
       *
       * It returns full `StringingJob` docs like the bench does, so the archive
       * row can flag "still owed" from `isBillable` without a second fetch.
       */
      const wantArchived = req.nextUrl.searchParams.get('archived') === 'true';
      const scope = wantArchived ? ARCHIVED_SQL : LIVE_SQL;
      const query = mine
        ? {
            query: `SELECT * FROM c WHERE c.stringerId = @stringerId AND ${scope}`,
            parameters: [{ name: '@stringerId', value: admin.memberId }],
          }
        : { query: `SELECT * FROM c WHERE ${scope}`, parameters: [] };
      const { resources } = await container.items.query<StringingJob>(query).fetchAll();
      const jobs = resources
        .filter((j) => isArchived(j) === wantArchived)
        .sort(benchOrder);
      return NextResponse.json({ jobs, view: 'bench' });
    }

    // Their own jobs, stripped. Single-partition — the reason `/memberId` is
    // the partition key.
    //
    // Identity from EITHER cookie: `/api/admin` does not mint a
    // `member_session`, so an admin asking for the player view has only the
    // admin cookie to identify them by. Falling back to it is what lets a
    // stringer see their own rackets on Home.
    const memberId = caller?.memberId ?? (admin.authed ? admin.memberId : null);
    if (!memberId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const { resources } = await container.items
      .query<StringingJob>({
        query: `SELECT * FROM c WHERE c.memberId = @memberId AND ${LIVE_SQL}`,
        parameters: [{ name: '@memberId', value: memberId }],
      })
      .fetchAll();
    // A player never sees an archived job. Archiving is how a stringer says
    // "this is done with"; leaving it on someone's Home card afterwards would
    // make the two screens disagree about the same racket.
    const jobs = resources
      .filter((j) => !isArchived(j))
      .sort(benchOrder)
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
