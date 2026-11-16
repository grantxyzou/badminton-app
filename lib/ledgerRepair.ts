/**
 * The one ledger repair an admin can run from the Ledger check: give a
 * DELETED stringing job back the charge its deletion took.
 *
 * Until 2026-11-16 deleting an archived job voided its charge whatever its
 * state, so a job that had been PAID left its payment standing alone, and the
 * reconcile showed "stringing job (deleted) · ledger −$40 · app $0" every day.
 * The delete no longer does that (`mirrorStringingDeleted` keeps a paid job's
 * books), but a job already deleted cannot heal itself: there is nothing left
 * to touch. This writes the missing charge, once, so its payment has its bill.
 *
 * Narrow on purpose (the reconcile's no-auto-repair rule): a person taps it,
 * for a job that is GONE, whose live entries are payments and no charge.
 * Anything else is refused. The id follows the mirror's own charge numbering
 * (`charge:<job>:<n>`), so a second tap finds the entry and 409s.
 */
import type { GroupScope } from './groupScope';
import { appendEntry } from './ledgerMirror';
import { ensureLedger } from './storeCredit';
import type { LedgerEntry, StringingJob } from './types';

export type RestoreOutcome = 'restored' | 'job_exists' | 'nothing_to_restore' | 'failed';

export async function restoreDeletedJobCharge(
  scope: GroupScope,
  memberId: string,
  jobId: string,
): Promise<{ outcome: RestoreOutcome; amountCents?: number }> {
  const job = await scope.read<StringingJob>('stringingJobs', jobId, memberId);
  // A job that still exists heals on its next change (the mirror writes a missing charge).
  if (job) return { outcome: 'job_exists' };

  await ensureLedger();
  const rows = await scope.query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: memberId }],
    partitionKey: memberId,
  });
  // Re-checked in JS: the mock store filters by parameter name only.
  const mine = rows.filter(
    (e) => e.memberId === memberId && e.ref?.kind === 'stringing' && e.ref.id === jobId && (e.account ?? 'member_credit') === 'member_owed',
  );
  const voided = new Set(mine.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  const live = mine.filter((e) => e.kind !== 'void' && !voided.has(e.id));
  const liveCharges = live.filter((e) => e.kind === 'charge');
  const livePayments = live.filter((e) => e.kind === 'payment');
  const paid = -livePayments.reduce((n, e) => n + e.amountCents, 0);
  if (liveCharges.length > 0 || paid <= 0) return { outcome: 'nothing_to_restore' };

  const charges = mine.filter((e) => e.kind === 'charge');
  const lastCharge = charges.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).at(-1);
  const firstPaid = livePayments.map((e) => e.createdAt).filter((x): x is string => typeof x === 'string').sort()[0];

  const written = await appendEntry(scope, {
    id: `charge:${jobId}:${charges.length}`,
    memberId,
    account: 'member_owed',
    kind: 'charge',
    amountCents: paid,
    note: lastCharge?.note ?? 'Stringing',
    ref: { kind: 'stringing', id: jobId, pk: memberId },
    meta: { reason: 'restored_deleted_job' },
    // Dated with the money it pairs with, so the month's books net to zero.
    ...(firstPaid ? { createdAt: firstPaid } : {}),
  });
  if (written === 'written') return { outcome: 'restored', amountCents: paid };
  if (written === 'existing') return { outcome: 'nothing_to_restore' };
  return { outcome: 'failed' };
}
