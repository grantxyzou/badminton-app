/**
 * WHAT ONE PERSON HAS PAID, month by month — the chart on Profile → Account
 * balance (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §4).
 *
 * Built from the ROWS, not the ledger: `Player.paid` stays the truth until the
 * ledger reconcile has run clean (CLAUDE.md, "Payments inbox and the ledger").
 * The reads are the player-first ones the balance uses (`lib/owedRows.ts`):
 * this person's own rows, their guests' rows and their legacy name rows, so a
 * line paid here is a line that was owed on Home.
 *
 * Three series, never gift cards: only an organiser makes one, and a player
 * never pays for one (Grant, 2026-11-09).
 *   - sessions:  this person's own `players` rows marked paid;
 *   - stringing: their `stringingJobs` with a `paidAt`;
 *   - other:     the shares of guests they brought (`guestOf`).
 *
 * A row is placed in the month it was PAID (`paidAt`, Vancouver time). Rows
 * marked before 2026-10 carry no `paidAt`; those fall back to when the bill
 * was frozen, then to the session's own date, which is the best a row can say.
 * A paid row with no frozen amount (paid at an estimate and never settled)
 * has no figure to add, so it is left out rather than guessed.
 */
import type { GroupScope } from './groupScope';
import { loadOwedInputs } from './owedRows';
import { isFlagOn } from './flags';
import type { ResolvedIdentity } from './playerIdentity';
import type { Player, Session, StringingJob } from './types';

export const PAYMENT_MONTHS_DEFAULT = 6;
export const PAYMENT_MONTHS_MAX = 12;

export interface PaymentMonth {
  /** `YYYY-MM`, Vancouver time. */
  month: string;
  /** Cents. */
  sessions: number;
  stringing: number;
  other: number;
  /** How many of this person's own session nights went into `sessions`. */
  nights: number;
  /** One per guest share in `other`, oldest first. */
  guests: Array<{ name: string; date: string }>;
}

const MONTH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit' });

/** `YYYY-MM` of an instant, in Vancouver; null for a broken date. */
export function monthOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = MONTH_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return y && m ? `${y}-${m}` : null;
}

/** The last `n` calendar months ending with `now`'s, oldest first. */
export function lastMonths(n: number, now: Date): string[] {
  const current = monthOf(now.toISOString())!;
  let [y, m] = current.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/**
 * The fold, pure: rows in, months out. Every month in the window is present,
 * empty or not, so the chart's axis never depends on what was paid.
 */
export function foldPayments(
  input: { players: Player[]; sessionById: Map<string, Session>; jobs: StringingJob[]; memberId: string | null },
  window: string[],
): PaymentMonth[] {
  const byMonth = new Map<string, PaymentMonth>(
    window.map((month) => [month, { month, sessions: 0, stringing: 0, other: 0, nights: 0, guests: [] }]),
  );

  const guestRows: Array<{ month: string; name: string; date: string }> = [];
  for (const p of input.players) {
    if (p.paid !== true) continue;
    if (typeof p.owedAmount !== 'number' || p.owedAmount <= 0) continue;
    const session = input.sessionById.get(p.sessionId);
    const month = monthOf(p.paidAt) ?? monthOf(p.settledAt) ?? monthOf(session?.datetime);
    const bucket = month ? byMonth.get(month) : undefined;
    if (!bucket) continue;
    if (typeof p.guestOf === 'string' && p.guestOf) {
      bucket.other += cents(p.owedAmount);
      guestRows.push({ month: bucket.month, name: p.guestName ?? p.name, date: session?.datetime ?? p.paidAt ?? '' });
    } else {
      bucket.sessions += cents(p.owedAmount);
      bucket.nights += 1;
    }
  }
  guestRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const g of guestRows) byMonth.get(g.month)!.guests.push({ name: g.name, date: g.date });

  for (const job of input.jobs) {
    if (input.memberId && job.memberId !== input.memberId) continue;
    if (!job.paidAt || typeof job.priceCents !== 'number' || job.priceCents <= 0) continue;
    const bucket = byMonth.get(monthOf(job.paidAt) ?? '');
    if (bucket) bucket.stringing += Math.round(job.priceCents);
  }

  return window.map((m) => byMonth.get(m)!);
}

/** This person's paid stringing jobs in this club; [] when stringing is off. */
async function paidJobs(scope: GroupScope, memberId: string | null): Promise<StringingJob[]> {
  if (!memberId || !isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return [];
  const rows = await scope.query<StringingJob>('stringingJobs', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: memberId }],
    partitionKey: memberId,
  });
  return rows.filter((j) => j.memberId === memberId);
}

export async function memberPayments(
  scope: GroupScope,
  identity: Pick<ResolvedIdentity, 'memberId' | 'names'>,
  months: number,
  now: Date = new Date(),
): Promise<PaymentMonth[]> {
  const [{ players, sessionById }, jobs] = await Promise.all([
    // `includeLegacy`: a whole-history read of this person's own rows, where
    // BPM's earliest weeks sit under the legacy session id.
    loadOwedInputs(scope, identity, { includeLegacy: true }),
    paidJobs(scope, identity.memberId),
  ]);
  return foldPayments({ players, sessionById, jobs, memberId: identity.memberId }, lastMonths(months, now));
}
