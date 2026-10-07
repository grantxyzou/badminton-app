/**
 * THE LEDGER BACKFILL — writing history into the ledger the mirror did not
 * see (docs/plans/payments.md, Phase 2 stage 1).
 *
 * Three units, each walked oldest first with a cursor:
 *   sessions      — every SETTLED session: a charge per row with a frozen
 *                   owed amount, a payment per paid row, a cover per
 *                   absorb-covered row, the court cost once.
 *   stringingJobs — every billable-shaped job: a charge; paid → a payment.
 *   birds         — every purchase (never an adjustment doc).
 *
 * IDEMPOTENT BY THE IDS, not by a stamp. The entries it writes are the ones
 * `lib/ledgerMirror.ts`'s builders produce for the same rows, so a row the
 * mirror already handled 409s here and is counted `existing`. That is also
 * what makes "re-run until `remaining` is empty" literal, and what makes a
 * repair after a mirror failure the same command as the first run.
 *
 * BOUNDED, because a request is (the `groupBackfill` argument): `limit` rows
 * per unit, a global `budget`, a soft deadline well inside App Service's 230s.
 * `remaining` names each unit with more and the cursor to resume from, because
 * a 409-only re-scan still spends RU and must terminate too.
 *
 * Legacy rows: a `paid` row from before 2026-10 has no `paidAt`/`paidVia`, so
 * its payment is keyed `legacy` and dated by the settle. A row with no
 * memberId goes under `~unlinked`; the reconcile reports those.
 */
import { groupScope, type GroupScope } from './groupScope';
import {
  appendEntry,
  chargeEntry,
  coverEntry,
  courtCostEntry,
  paymentEntry,
  shuttlePurchaseEntry,
  stringingChargeEntry,
  stringingPaymentEntry,
  type NewEntry,
} from './ledgerMirror';
import { ensureLedger } from './storeCredit';
import type { BirdPurchase, LedgerEntry, Player, Session, StringingJob } from './types';

export type BackfillUnit = 'sessions' | 'stringingJobs' | 'birds';
export const BACKFILL_UNITS: readonly BackfillUnit[] = ['sessions', 'stringingJobs', 'birds'];

export const DEFAULT_LIMIT = 200;
export const DEFAULT_BUDGET = 1500;
const SOFT_DEADLINE_MS = 150_000;

export interface LedgerBackfillSummary {
  dryRun: boolean;
  written: Record<BackfillUnit, number>;
  existing: Record<BackfillUnit, number>;
  failed: Record<BackfillUnit, number>;
  /** Primary rows looked at per unit. */
  scanned: Record<BackfillUnit, number>;
  limit: number;
  budget: number;
  stoppedEarly: 'budget' | 'deadline' | null;
  /** Units with more to do, and the cursor to resume each from. */
  remaining: Partial<Record<BackfillUnit, { after: string }>>;
}

export interface LedgerBackfillStatus {
  /** Settled sessions whose rows have no charge entry yet (bounded). */
  sessionsWithoutEntries: number;
  jobsWithoutEntries: number;
  purchasesWithoutEntries: number;
  ledgerEntries: number;
  truncated: boolean;
}

const zero = (): Record<BackfillUnit, number> => ({ sessions: 0, stringingJobs: 0, birds: 0 });

/** What the backfill would write for one settled session. */
export function sessionEntries(session: Session, rows: Player[]): NewEntry[] {
  const out: NewEntry[] = [];
  if (!session.settled) return out;
  for (const row of rows) {
    if (!row.settledAt) continue;
    const c = chargeEntry(row, session);
    if (c) out.push(c);
    if (row.paid === true) {
      const p = paymentEntry({ ...row, paidAt: row.paidAt ?? row.settledAt });
      if (p) out.push({ ...p, ...(row.paidAt ? {} : { id: `payment:${row.id}:legacy`, createdAt: row.settledAt }) });
    }
    if (row.writtenOff === true && (row.coverMode ?? 'absorb') === 'absorb') {
      const cv = coverEntry(row, 0);
      if (cv) out.push(cv);
    }
  }
  const court = courtCostEntry(session, session.settled);
  if (court) out.push(court);
  return out;
}

const BILLABLE = new Set(['ready', 'picked_up']);
export function jobEntries(job: StringingJob): NewEntry[] {
  const out: NewEntry[] = [];
  const billable = typeof job.priceCents === 'number' && job.priceCents > 0 && BILLABLE.has(job.status);
  if (billable) {
    const c = stringingChargeEntry(job, 0);
    if (c) out.push(c);
  }
  if (job.paidAt && typeof job.priceCents === 'number' && job.priceCents > 0) {
    const p = stringingPaymentEntry(job, 'manual');
    if (p) out.push(p);
  }
  return out;
}

export function purchaseEntries(p: BirdPurchase & { type?: string }): NewEntry[] {
  if (p.type === 'adjustment') return [];
  const e = shuttlePurchaseEntry(p);
  return e ? [e] : [];
}

async function writeAll(scope: GroupScope, entries: NewEntry[], dryRun: boolean, tally: { written: number; existing: number; failed: number }): Promise<void> {
  for (const e of entries) {
    if (dryRun) {
      tally.written += 1;
      continue;
    }
    const r = await appendEntry(scope, e);
    tally[r] += 1;
  }
}

/**
 * Sessions, settled, oldest first, after a datetime cursor. The mock ignores
 * ORDER BY and LIMIT, so both are applied again in JS.
 */
async function settledSessionsAfter(scope: GroupScope, after: string, cap: number): Promise<Session[]> {
  const rows = await scope.query<Session>('sessions', {
    where: 'IS_DEFINED(c.settled) AND c.datetime > @after',
    params: [{ name: '@after', value: after }],
    orderBy: 'c.datetime ASC',
    limit: cap + 1,
  });
  return rows
    .filter((s) => s.settled && typeof s.datetime === 'string' && s.datetime > after)
    .sort((a, b) => (a.datetime < b.datetime ? -1 : 1))
    .slice(0, cap + 1);
}

async function rowsOfSession(scope: GroupScope, sessionId: string): Promise<Player[]> {
  const rows = await scope.query<Player>('players', {
    where: 'c.sessionId = @sessionId',
    params: [{ name: '@sessionId', value: sessionId }],
  });
  return rows.filter((r) => r.sessionId === sessionId);
}

async function jobsAfter(scope: GroupScope, after: string, cap: number): Promise<StringingJob[]> {
  const rows = await scope.query<StringingJob>('stringingJobs', {
    where: 'c.createdAt > @after',
    params: [{ name: '@after', value: after }],
    orderBy: 'c.createdAt ASC',
    limit: cap + 1,
  });
  return rows
    .filter((j) => typeof j.createdAt === 'string' && j.createdAt > after)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, cap + 1);
}

async function purchasesAfter(scope: GroupScope, after: string, cap: number): Promise<(BirdPurchase & { type?: string })[]> {
  const rows = await scope.query<BirdPurchase & { type?: string }>('birds', {
    where: 'c.createdAt > @after',
    params: [{ name: '@after', value: after }],
    orderBy: 'c.createdAt ASC',
    limit: cap + 1,
  });
  return rows
    .filter((p) => p.type !== 'adjustment' && typeof p.createdAt === 'string' && p.createdAt > after)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, cap + 1);
}

export async function runLedgerBackfill(
  groupId: string,
  opts: { dryRun?: boolean; limit?: number; budget?: number; after?: Partial<Record<BackfillUnit, string>>; deadlineMs?: number } = {},
): Promise<LedgerBackfillSummary> {
  await ensureLedger();
  const scope = groupScope(groupId);
  const dryRun = opts.dryRun !== false;
  const limit = Math.max(1, Math.min(2000, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
  const budget = Math.max(1, Math.min(20000, Math.floor(opts.budget ?? DEFAULT_BUDGET)));
  const deadlineMs = opts.deadlineMs ?? SOFT_DEADLINE_MS;
  const startedAt = Date.now();
  const summary: LedgerBackfillSummary = {
    dryRun,
    written: zero(),
    existing: zero(),
    failed: zero(),
    scanned: zero(),
    limit,
    budget,
    stoppedEarly: null,
    remaining: {},
  };
  let spent = 0;
  const exhausted = () => {
    if (summary.stoppedEarly) return true;
    if (spent >= budget) summary.stoppedEarly = 'budget';
    else if (Date.now() - startedAt > deadlineMs) summary.stoppedEarly = 'deadline';
    return summary.stoppedEarly !== null;
  };

  // ── sessions ──
  {
    const unit: BackfillUnit = 'sessions';
    const after = opts.after?.sessions ?? '';
    const page = await settledSessionsAfter(scope, after, limit);
    const more = page.length > limit;
    const batch = page.slice(0, limit);
    let last = after;
    const tally = { written: 0, existing: 0, failed: 0 };
    for (const session of batch) {
      if (exhausted()) break;
      const rows = await rowsOfSession(scope, session.id);
      const entries = sessionEntries(session, rows);
      await writeAll(scope, entries, dryRun, tally);
      summary.scanned[unit] += 1;
      spent += 1 + entries.length;
      last = session.datetime;
    }
    summary.written[unit] = tally.written;
    summary.existing[unit] = tally.existing;
    summary.failed[unit] = tally.failed;
    if (more || summary.scanned[unit] < batch.length) summary.remaining[unit] = { after: last };
  }

  // ── stringing jobs ──
  if (!exhausted()) {
    const unit: BackfillUnit = 'stringingJobs';
    const after = opts.after?.stringingJobs ?? '';
    const page = await jobsAfter(scope, after, limit);
    const more = page.length > limit;
    const batch = page.slice(0, limit);
    let last = after;
    const tally = { written: 0, existing: 0, failed: 0 };
    for (const job of batch) {
      if (exhausted()) break;
      const entries = jobEntries(job);
      await writeAll(scope, entries, dryRun, tally);
      summary.scanned[unit] += 1;
      spent += 1 + entries.length;
      last = job.createdAt;
    }
    summary.written[unit] = tally.written;
    summary.existing[unit] = tally.existing;
    summary.failed[unit] = tally.failed;
    if (more || summary.scanned[unit] < batch.length) summary.remaining[unit] = { after: last };
  }

  // ── purchases ──
  if (!exhausted()) {
    const unit: BackfillUnit = 'birds';
    const after = opts.after?.birds ?? '';
    const page = await purchasesAfter(scope, after, limit);
    const more = page.length > limit;
    const batch = page.slice(0, limit);
    let last = after;
    const tally = { written: 0, existing: 0, failed: 0 };
    for (const p of batch) {
      if (exhausted()) break;
      const entries = purchaseEntries(p);
      await writeAll(scope, entries, dryRun, tally);
      summary.scanned[unit] += 1;
      spent += 1 + entries.length;
      last = p.createdAt;
    }
    summary.written[unit] = tally.written;
    summary.existing[unit] = tally.existing;
    summary.failed[unit] = tally.failed;
    if (more || summary.scanned[unit] < batch.length) summary.remaining[unit] = { after: last };
  }

  return summary;
}

/** How much history the ledger is still missing. Bounded; a zero is exact. */
export async function ledgerBackfillStatus(groupId: string, cap = 500): Promise<LedgerBackfillStatus> {
  await ensureLedger();
  const scope = groupScope(groupId);
  const entries = await scope.query<Pick<LedgerEntry, 'id' | 'ref' | 'kind'>>('ledger', { select: 'c.id, c.ref, c.kind' });
  const chargedRefs = new Set(entries.filter((e) => e.kind === 'charge' || e.kind === 'court_cost' || e.kind === 'shuttle_purchase').map((e) => e.ref?.id).filter(Boolean));
  let truncated = false;

  const sessions = await settledSessionsAfter(scope, '', cap);
  if (sessions.length > cap) truncated = true;
  let sessionsWithout = 0;
  for (const s of sessions.slice(0, cap)) {
    if (!chargedRefs.has(s.id)) {
      // No court entry — but a session may have zero court cost; check its rows too.
      const rows = await rowsOfSession(scope, s.id);
      const owedRows = rows.filter((r) => r.settledAt && (r.owedAmount ?? 0) > 0);
      if (owedRows.some((r) => !chargedRefs.has(r.id)) || (s.settled && (s.settled.courtTotal ?? 0) > 0)) sessionsWithout += 1;
    }
  }

  const jobs = await jobsAfter(scope, '', cap);
  if (jobs.length > cap) truncated = true;
  const jobsWithout = jobs.slice(0, cap).filter((j) => jobEntries(j).some((e) => e.kind === 'charge') && !chargedRefs.has(j.id)).length;

  const purchases = await purchasesAfter(scope, '', cap);
  if (purchases.length > cap) truncated = true;
  const purchasesWithout = purchases.slice(0, cap).filter((p) => purchaseEntries(p).length > 0 && !chargedRefs.has(p.id)).length;

  return {
    sessionsWithoutEntries: sessionsWithout,
    jobsWithoutEntries: jobsWithout,
    purchasesWithoutEntries: purchasesWithout,
    ledgerEntries: entries.length,
    truncated,
  };
}
