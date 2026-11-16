/**
 * The club's ledger as a STATEMENT (`docs/plans/ledger-entries.md`): every
 * entry in the window, newest first, each with who, what, how and whether a
 * later entry reversed it. READ-ONLY, admin-only (it names who paid what).
 *
 * The same container and the same dating rule as the Ledger page's sums
 * (`lib/ledgerView.ts`): an entry belongs to the date of its money, and a
 * reversal (a void) to the date of the entry it reverses, so the list and the
 * totals above it cover the same entries.
 */
import type { GroupScope } from './groupScope';
import { effectiveDate, rangeWindow, type RangeKey } from './ledgerView';
import { ANON_LEDGER_ID, CLUB_LEDGER_ID, UNLINKED_LEDGER_ID } from './ledgerMirror';
import { rosterMembers } from './roster';
import { WALK_UP_ID_PREFIX } from './stringing';
import { ensureLedger } from './storeCredit';
import type { LedgerEntry, StringingJob } from './types';

export interface StatementEntry {
  id: string;
  /** The date the money belongs to (ISO). */
  date: string;
  account: 'member_owed' | 'member_credit' | 'club_outlay';
  kind: LedgerEntry['kind'];
  /** For a reversal: the kind of entry it reverses. */
  reverses: LedgerEntry['kind'] | null;
  amountCents: number;
  /** A person's roster name, or "Club", "Walk-up", "Former member", "Unlinked". */
  who: string;
  /** What the money was for: "Nov 13 session", "J-0006 · Astrox 88D Pro", "Courts · Nov 13", or the entry's note. */
  what: string;
  /** How a payment arrived (card, e-transfer, credit, marked paid). */
  via: string | null;
  /** Why a reversal was written. */
  reason: string | null;
  /** A later reversal cancelled this entry. */
  reversed: boolean;
}

export interface Statement {
  range: RangeKey;
  entries: StatementEntry[];
  /** More entries in the window than `limit`: the oldest were left off. */
  truncated: boolean;
}

const DATE_IN_ID = /(\d{4}-\d{2}-\d{2})$/;

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function whoOf(memberId: string, names: Map<string, string>): string {
  if (memberId === CLUB_LEDGER_ID) return 'Club';
  if (memberId === UNLINKED_LEDGER_ID) return 'Unlinked';
  if (memberId === ANON_LEDGER_ID) return 'Former member';
  if (memberId.startsWith(WALK_UP_ID_PREFIX)) return 'Walk-up';
  return names.get(memberId) ?? 'Removed member';
}

function whatOf(e: LedgerEntry, jobs: Map<string, Pick<StringingJob, 'jobNo' | 'racketLabel'>>): string {
  const ref = e.ref;
  if (ref?.kind === 'session') {
    const day = DATE_IN_ID.exec(ref.pk)?.[1];
    return day ? `${shortDay(day)} session` : 'Session';
  }
  if (ref?.kind === 'stringing') {
    const job = jobs.get(ref.id);
    if (job) return [job.jobNo, job.racketLabel].filter(Boolean).join(' · ');
    return `${e.note || 'Stringing'} (job deleted)`;
  }
  if (ref?.kind === 'court') {
    const day = DATE_IN_ID.exec(ref.id)?.[1];
    return day ? `Courts · ${shortDay(day)} session` : 'Courts';
  }
  return e.note || e.kind;
}

/** The statement for one club and window, newest first, at most `limit` entries. */
export async function listLedgerEntries(
  scope: GroupScope,
  range: RangeKey,
  now: number = Date.now(),
  limit = 500,
): Promise<Statement> {
  await ensureLedger();
  const [all, roster, jobs] = await Promise.all([
    scope.query<LedgerEntry>('ledger'),
    rosterMembers(scope.groupId, { includeInactive: true }),
    scope.query<Pick<StringingJob, 'id' | 'jobNo' | 'racketLabel'>>('stringingJobs', { select: 'c.id, c.jobNo, c.racketLabel' }),
  ]);
  const names = new Map(roster.map(({ member }) => [member.id, member.name] as const));
  const jobById = new Map(jobs.map((j) => [j.id, j] as const));
  const byId = new Map(all.map((e) => [e.id, e] as const));
  const reversed = new Set(all.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));

  const { from, to } = rangeWindow(range, now);
  // A day-only date (an expense's own day) counts once it has begun anywhere (lib/ledgerView.ts).
  const top = to + 24 * 60 * 60 * 1000;
  const inWindow = all
    .map((e) => ({ e, date: effectiveDate(e, byId) }))
    .filter(({ date }) => {
      const t = Date.parse(date);
      return Number.isFinite(t) && t >= from && t <= top;
    })
    .sort((a, b) => (a.date === b.date ? (a.e.createdAt < b.e.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));

  const entries = inWindow.slice(0, limit).map(({ e, date }): StatementEntry => {
    const original = e.kind === 'void' ? byId.get(e.id.slice('void:'.length)) : undefined;
    const subject = original ?? e;
    return {
      id: e.id,
      date,
      account: e.account ?? 'member_credit',
      kind: e.kind,
      reverses: e.kind === 'void' ? (original?.kind ?? null) : null,
      amountCents: e.amountCents,
      who: whoOf(e.memberId, names),
      what: whatOf(subject, jobById),
      via: subject.meta?.via ?? null,
      reason: e.kind === 'void' ? (e.meta?.reason ?? null) : null,
      reversed: reversed.has(e.id),
    };
  });
  return { range, entries, truncated: inWindow.length > limit };
}
