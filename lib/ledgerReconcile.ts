/**
 * THE LEDGER RECONCILE — Phase 2 of docs/plans/payments.md, stage 2.
 *
 * Proves the mirror (`lib/ledgerMirror.ts`) still matches the rows the app
 * reads. For every person on the roster it puts two answers side by side:
 *
 *   LIVE   — the FROZEN lines Home shows them (`computeOwedForRoster`): a
 *            settled session row with money on it, a billable stringing job.
 *            An unsettled session's live estimate is left out on purpose —
 *            the ledger records nothing until settle freezes a bill, so
 *            comparing an estimate would report a mismatch every week by design.
 *   LEDGER — the open balance per ref: Σ `member_owed` entries for that row
 *            (charge + payment + cover + voids), whatever partition they sit
 *            in (`~unlinked` for a legacy row with no memberId).
 *
 * A ref the two disagree on is ONE mismatch with a reason code:
 *   missing_charge   live has the line, the ledger has nothing for the row
 *   missing_payment  the ledger still shows it open, the row says paid
 *   stale_charge     the ledger still shows it open, the row no longer owes
 *                    (unsettled, covered, zeroed, or gone)
 *   amount_mismatch  both know the row and disagree on the number
 *
 * NO AUTO-REPAIR. Ids are deterministic, so the repair for every code is the
 * same command as the first run: the backfill (`POST /api/admin/ledger-backfill`)
 * for a missing entry, or the admin re-doing the action for a missing void.
 * A reconcile that wrote entries would be a second mirror with its own bugs.
 *
 * Runs once a day from the club's script (`POST /api/payments/remind`, whether
 * or not reminders are on) and on an admin's tap. The result is stored on the
 * club's payments settings doc — ids and cents, never names — and the
 * E-transfers card warns on a mismatch or a stale check.
 */
import { groupScope, type GroupScope } from './groupScope';
import { getMirrorFailures, UNLINKED_LEDGER_ID } from './ledgerMirror';
import { computeOwedForRoster } from './owedBalance';
import { notePaymentsSettings, readPaymentsSettings } from './paymentsInbox';
import { accountOf, ensureLedger } from './storeCredit';
import type { LedgerEntry, Player, StringingJob } from './types';

export type MismatchCode = 'missing_charge' | 'missing_payment' | 'stale_charge' | 'amount_mismatch';

export interface Mismatch {
  memberId: string;
  ref: { kind: 'session' | 'stringing'; id: string; pk: string };
  code: MismatchCode;
  ledgerCents: number;
  liveCents: number;
}

export interface ReconcileResult {
  at: string;
  /** Refs compared: every live frozen line plus every open ledger ref. */
  checked: number;
  mismatches: Mismatch[];
  /** Live lines whose entries sit under `~unlinked` — matched, but the ledger cannot name the person. */
  unlinked: number;
  /** The stored list was cut to `STORED_MISMATCH_CAP`. */
  truncated: boolean;
  /** Mirror writes that threw since this process started — a hint, not a count of gaps. */
  mirrorFailures: number;
}

/** Ids only on the settings doc: a mismatch list is not a place for names, and fifty is plenty to act on. */
export const STORED_MISMATCH_CAP = 50;

interface OpenRef {
  kind: 'session' | 'stringing';
  pk: string;
  /** The partition the entries sit in — the member, or `~unlinked`. */
  memberId: string;
  cents: number;
}

/** The open `member_owed` balance per row, from one projected scan of the club's ledger. */
async function openLedgerRefs(scope: GroupScope): Promise<Map<string, OpenRef>> {
  await ensureLedger();
  const rows = await scope.query<Pick<LedgerEntry, 'memberId' | 'account' | 'kind' | 'amountCents' | 'ref'>>('ledger', {
    select: 'c.memberId, c.account, c.kind, c.amountCents, c.ref',
  });
  const open = new Map<string, OpenRef>();
  for (const e of rows) {
    if (accountOf(e) !== 'member_owed') continue;
    const ref = e.ref;
    if (!ref || (ref.kind !== 'session' && ref.kind !== 'stringing') || typeof ref.id !== 'string') continue;
    const cur = open.get(ref.id);
    if (cur) cur.cents += e.amountCents;
    else open.set(ref.id, { kind: ref.kind, pk: ref.pk, memberId: e.memberId, cents: e.amountCents });
  }
  return open;
}

/**
 * The row behind an open ledger ref, as the reconcile needs it: `null` when
 * it is gone. `owedCents` is what the row itself says is still frozen on it —
 * the live answer for a row nobody on the roster is shown (an unlinked
 * legacy row, whose name matches no member).
 */
async function rowState(scope: GroupScope, ref: OpenRef, id: string): Promise<{ paid: boolean; owedCents: number } | null> {
  if (ref.kind === 'session') {
    const row = await scope.read<Player>('players', id, ref.pk);
    if (!row) return null;
    const frozen = typeof row.settledAt === 'string' && row.paid !== true && row.writtenOff !== true;
    return { paid: row.paid === true, owedCents: frozen ? Math.round((row.owedAmount ?? 0) * 100) : 0 };
  }
  const job = await scope.read<StringingJob>('stringingJobs', id, ref.pk);
  if (!job) return null;
  const paid = typeof job.paidAt === 'string';
  const billable = !paid && typeof job.priceCents === 'number' && job.priceCents > 0 && (job.status === 'ready' || job.status === 'picked_up');
  return { paid, owedCents: billable ? Math.round(job.priceCents!) : 0 };
}

export async function runReconcile(groupId: string, now: number = Date.now()): Promise<ReconcileResult> {
  const scope = groupScope(groupId);
  const [roster, open] = await Promise.all([computeOwedForRoster(scope, now), openLedgerRefs(scope)]);

  const mismatches: Mismatch[] = [];
  let unlinked = 0;
  const seen = new Set<string>();

  for (const { memberId, balance } of roster) {
    const live: { kind: 'session' | 'stringing'; id: string; pk: string; cents: number }[] = [
      ...balance.sessions.filter((s) => s.settled).map((s) => ({ kind: 'session' as const, id: s.playerId, pk: s.sessionId, cents: Math.round(s.owedAmount * 100) })),
      ...balance.stringing.map((c) => ({ kind: 'stringing' as const, id: c.jobId, pk: memberId, cents: Math.round(c.amount * 100) })),
    ];
    for (const line of live) {
      seen.add(line.id);
      const entry = open.get(line.id);
      const ref = { kind: line.kind, id: line.id, pk: line.pk };
      if (!entry) {
        mismatches.push({ memberId, ref, code: 'missing_charge', ledgerCents: 0, liveCents: line.cents });
        continue;
      }
      if (entry.memberId === UNLINKED_LEDGER_ID) unlinked += 1;
      if (entry.cents !== line.cents) {
        mismatches.push({ memberId, ref, code: 'amount_mismatch', ledgerCents: entry.cents, liveCents: line.cents });
      }
    }
  }

  // Open in the ledger, and nobody on the roster is shown the line.
  for (const [id, entry] of open) {
    if (seen.has(id) || entry.cents === 0) continue;
    const ref = { kind: entry.kind, id, pk: entry.pk };
    if (entry.cents < 0) {
      // A payment with no charge under it — the charge write failed, or was voided alone.
      mismatches.push({ memberId: entry.memberId, ref, code: 'amount_mismatch', ledgerCents: entry.cents, liveCents: 0 });
      continue;
    }
    const row = await rowState(scope, entry, id);
    if (row?.paid) {
      mismatches.push({ memberId: entry.memberId, ref, code: 'missing_payment', ledgerCents: entry.cents, liveCents: 0 });
      continue;
    }
    // An unlinked legacy row (no memberId, a name no member carries) is shown
    // to nobody, so the ROW is its live side: still frozen at the same amount
    // → the ledger is right about it, and only the person is unknown.
    if (entry.memberId === UNLINKED_LEDGER_ID && row && row.owedCents === entry.cents) {
      unlinked += 1;
      continue;
    }
    mismatches.push({ memberId: entry.memberId, ref, code: 'stale_charge', ledgerCents: entry.cents, liveCents: row?.owedCents ?? 0 });
  }

  const compared = new Set(seen);
  for (const [id, entry] of open) if (entry.cents !== 0) compared.add(id);

  return {
    at: new Date(now).toISOString(),
    checked: compared.size,
    mismatches,
    unlinked,
    truncated: false,
    mirrorFailures: getMirrorFailures(),
  };
}

/** Run, then remember the outcome on the club's payments settings doc (ids and cents, never names). */
export async function reconcileAndRecord(groupId: string, now: number = Date.now()): Promise<ReconcileResult> {
  const result = await runReconcile(groupId, now);
  const truncated = result.mismatches.length > STORED_MISMATCH_CAP;
  await notePaymentsSettings(groupId, {
    lastReconcileAt: result.at,
    lastReconcileChecked: result.checked,
    lastReconcileUnlinked: result.unlinked,
    lastReconcileMismatches: result.mismatches.slice(0, STORED_MISMATCH_CAP),
    lastReconcileTruncated: truncated,
  });
  return { ...result, truncated };
}

/** The last stored outcome, or `null` when a check has never run. */
export async function lastReconcile(groupId: string): Promise<Omit<ReconcileResult, 'mirrorFailures'> | null> {
  const s = await readPaymentsSettings(groupId);
  if (!s?.lastReconcileAt) return null;
  return {
    at: s.lastReconcileAt,
    checked: s.lastReconcileChecked ?? 0,
    mismatches: s.lastReconcileMismatches ?? [],
    unlinked: s.lastReconcileUnlinked ?? 0,
    truncated: s.lastReconcileTruncated === true,
  };
}
