/**
 * What the Ledger check SHOWS about a mismatch, beyond its code
 * (`lib/ledgerReconcile.ts` stores ids and cents only, never names).
 *
 * For each listed line, read when the admin opens the sheet:
 *   - the thing it is about: a session row (its date, paid or covered or
 *     removed, or gone) or a stringing job (its number and racket, where it
 *     is on the bench, paid, invoiced, archived, withdrawn, or deleted);
 *   - the ledger's own entries for it, oldest first, each marked when a later
 *     void reversed it.
 *
 * READ-ONLY: it explains, it never repairs (the reconcile's no-auto-repair
 * rule). Admin-only, like the route that calls it: it names the job's racket
 * and what was paid.
 */
import type { GroupScope } from './groupScope';
import type { Mismatch } from './ledgerReconcile';
import type { LedgerEntry, Player, StringingJob } from './types';

export type MismatchSubject =
  | {
      kind: 'session';
      /** YYYY-MM-DD, from the session id. */
      date: string | null;
      exists: boolean;
      paid: boolean;
      paidVia: string | null;
      covered: boolean;
      removed: boolean;
      settled: boolean;
    }
  | {
      kind: 'stringing';
      exists: boolean;
      jobNo: string | null;
      racket: string | null;
      status: string | null;
      paidAt: string | null;
      paidVia: string | null;
      invoiced: boolean;
      billsOnInvoice: boolean;
      archived: boolean;
      withdrawn: boolean;
    };

export interface MismatchEntry {
  kind: LedgerEntry['kind'];
  amountCents: number;
  note: string;
  at: string | null;
  /** How a payment arrived, or why a void was written. */
  via: string | null;
  reason: string | null;
  /** A later void reversed this entry. */
  voided: boolean;
}

export interface MismatchDetail {
  subject: MismatchSubject;
  entries: MismatchEntry[];
}

const DATE_IN_ID = /(\d{4}-\d{2}-\d{2})$/;

async function subjectOf(scope: GroupScope, m: Mismatch): Promise<MismatchSubject> {
  if (m.ref.kind === 'session') {
    const row = await scope.read<Player>('players', m.ref.id, m.ref.pk);
    return {
      kind: 'session',
      date: DATE_IN_ID.exec(m.ref.pk)?.[1] ?? null,
      exists: !!row,
      paid: row?.paid === true,
      paidVia: row?.paidVia ?? null,
      covered: row?.writtenOff === true,
      removed: row?.removed === true,
      settled: typeof row?.settledAt === 'string',
    };
  }
  const job = await scope.read<StringingJob>('stringingJobs', m.ref.id, m.ref.pk);
  return {
    kind: 'stringing',
    exists: !!job,
    jobNo: job?.jobNo ?? null,
    racket: job?.racketLabel ?? null,
    status: job?.status ?? null,
    paidAt: job?.paidAt ?? null,
    paidVia: job?.paidVia ?? null,
    invoiced: typeof job?.invoice?.sentAt === 'string',
    billsOnInvoice: job?.billOn === 'invoice',
    archived: typeof job?.archivedAt === 'string' && job.archivedAt.length > 0,
    withdrawn: typeof job?.cancelledAt === 'string' && job.cancelledAt.length > 0,
  };
}

/** The ledger's entries for one row, oldest first. The partition is the mismatch's own (a member, or `~unlinked`). */
async function entriesOf(scope: GroupScope, m: Mismatch): Promise<MismatchEntry[]> {
  const rows = await scope.query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: m.memberId }],
    partitionKey: m.memberId,
  });
  const mine = rows.filter((e) => e.memberId === m.memberId && e.ref?.id === m.ref.id && (e.account ?? 'member_credit') === 'member_owed');
  const voided = new Set(mine.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return mine
    .map((e) => ({
      kind: e.kind,
      amountCents: e.amountCents,
      note: e.note,
      at: e.createdAt ?? null,
      via: e.meta?.via ?? null,
      reason: e.meta?.reason ?? null,
      voided: voided.has(e.id),
    }))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

export async function describeMismatch(scope: GroupScope, m: Mismatch): Promise<MismatchDetail> {
  const [subject, entries] = await Promise.all([subjectOf(scope, m), entriesOf(scope, m)]);
  return { subject, entries };
}
